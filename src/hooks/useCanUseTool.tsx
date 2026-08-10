import { APIUserAbortError } from '@anthropic-ai/sdk';
import type * as React from 'react';
import { useCallback } from 'react';
import { ASK_USER_QUESTION_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/AskUserQuestionTool/prompt.js';
import type { UserQuestionRequest } from '../components/permissions/UserQuestionDialog/UserQuestionDialog.js';
import type { Tool as ToolType, ToolUseContext } from '../Tool.js';
import type { AssistantMessage } from '../types/message.js';
import type { SafetyDecision } from '../types/safety.js';
import { AbortError } from '../utils/errors.js';
import { applyFixedSafetyPolicy } from '../utils/safety/fixedSafetyPolicy.js';
import { evaluateToolSafety } from '../utils/safety/toolSafety.js';

export type CanUseToolFn<Input extends Record<string, unknown> = Record<string, unknown>> = (
  tool: ToolType,
  input: Input,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: SafetyDecision<Input>,
) => Promise<SafetyDecision<Input>>;

function cancelledDecision(toolUseID: string): SafetyDecision {
  return {
    behavior: 'deny',
    message: 'Tool execution was cancelled',
    toolUseID,
    decisionReason: {
      type: 'asyncAgent',
      reason: 'Tool execution was cancelled',
    },
  };
}

function useCanUseTool(
  setUserQuestionQueue: React.Dispatch<React.SetStateAction<UserQuestionRequest[]>>,
): CanUseToolFn {
  return useCallback<CanUseToolFn>(
    async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => {
      try {
        const decision =
          forceDecision ?? (await evaluateToolSafety(tool, input, toolUseContext, assistantMessage, toolUseID));
        if (tool.name === ASK_USER_QUESTION_TOOL_NAME && decision.behavior === 'ask') {
          return await new Promise<SafetyDecision>(resolve => {
            let settled = false;
            const finish = (result: SafetyDecision) => {
              if (settled) return;
              settled = true;
              toolUseContext.abortController.signal.removeEventListener('abort', onAbort);
              setUserQuestionQueue(queue => queue.filter(item => item.toolUseID !== toolUseID));
              resolve(result);
            };
            const onAbort = () => finish(cancelledDecision(toolUseID));
            const request: UserQuestionRequest = {
              input,
              toolUseID,
              onAbort,
              onAllow(updatedInput, _feedback, contentBlocks) {
                finish({
                  behavior: 'allow',
                  updatedInput,
                  userModified: true,
                  contentBlocks,
                });
              },
              onReject(feedback, contentBlocks) {
                finish({
                  behavior: 'ask',
                  message: feedback ?? 'User declined to answer questions',
                  contentBlocks,
                });
              },
            };
            toolUseContext.abortController.signal.addEventListener('abort', onAbort, { once: true });
            setUserQuestionQueue(queue => [...queue, request]);
          });
        }
        return applyFixedSafetyPolicy(tool.name, input, decision);
      } catch (error) {
        if (error instanceof AbortError || error instanceof APIUserAbortError) {
          return cancelledDecision(toolUseID);
        }
        throw error;
      }
    },
    [setUserQuestionQueue],
  );
}

export default useCanUseTool;
