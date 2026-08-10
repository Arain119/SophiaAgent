import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { Text } from '@anthropic/ink';
import React from 'react';
import { buildTool, type ToolDef, type ToolResult, type ToolUseContext } from 'src/Tool.js';
import { findAutoPluginCandidates } from 'src/services/plugins/autoRegistry.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { installPluginFromMarketplace } from 'src/utils/plugins/pluginInstallationHelpers.js';
import { refreshActivePlugins } from 'src/utils/plugins/refresh.js';
import { z } from 'zod/v4';
import { AUTO_PLUGIN_TOOL_NAME } from './constants.js';
import { getPrompt } from './prompt.js';
import { renderToolResultMessage, renderToolUseMessage } from './UI.js';
import { runAutoPlugin, type AutoPluginDependencies, type AutoPluginOutput } from './runner.js';

export const inputSchema = lazySchema(() =>
  z.strictObject({
    task: z.string().min(1).max(2_000).describe('Describe the missing persistent capability with specific keywords.'),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;

export const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    pluginId: z.string().optional(),
    pluginName: z.string().optional(),
    marketplaceName: z.string().optional(),
    installed: z.boolean(),
    activated: z.boolean(),
    capabilities: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type Output = z.infer<OutputSchema> & AutoPluginOutput;

const defaultDependencies: AutoPluginDependencies = {
  discover: findAutoPluginCandidates,
  async install(candidate) {
    const result = await installPluginFromMarketplace({
      pluginId: candidate.pluginId,
      entry: candidate.entry,
      marketplaceName: candidate.marketplaceName,
      scope: 'user',
      trigger: 'auto',
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  },
  refresh: context => refreshActivePlugins(context.setAppState),
};

function addPluginNotification(
  context: ToolUseContext,
  pluginId: string,
  pluginName: string,
  marketplaceName: string,
  activated: boolean,
): void {
  context.addNotification?.({
    key: `auto-plugin-${pluginId}`,
    jsx: (
      <Text color="success">
        Automatically installed {pluginName} from {marketplaceName}
        {activated ? ' and activated it.' : '. Restart to activate it.'}
      </Text>
    ),
    priority: 'immediate',
    timeoutMs: 6000,
  });
}

export const AutoPluginTool = buildTool({
  name: AUTO_PLUGIN_TOOL_NAME,
  maxResultSizeChars: 20_000,
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  async description() {
    return 'Finds and automatically installs one trusted plugin for a missing persistent capability';
  },
  async prompt() {
    return getPrompt();
  },
  userFacingName() {
    return 'Plugin';
  },
  isConcurrencySafe() {
    return false;
  },
  isReadOnly() {
    return false;
  },
  async validateInput({ task }) {
    return task.trim()
      ? { result: true as const }
      : {
          result: false as const,
          message: 'Task description is required',
          errorCode: 1,
        };
  },
  async checkSafety(input) {
    return { behavior: 'allow' as const, updatedInput: input };
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call({ task }, context): Promise<ToolResult<Output>> {
    const result = await runAutoPlugin(task, context, defaultDependencies);
    if (result.data.installed && result.data.pluginName && result.data.marketplaceName) {
      addPluginNotification(
        context,
        result.data.pluginId ?? result.data.pluginName,
        result.data.pluginName,
        result.data.marketplaceName,
        result.data.activated,
      );
    }
    return result;
  },
  mapToolResultToToolResultBlockParam(result, toolUseID): ToolResultBlockParam {
    const content = result.success
      ? `Automatically installed ${result.pluginId}. ${result.activated ? 'Activated in the current session.' : 'Restart is required to activate it.'}`
      : (result.reason ?? 'No plugin was installed.');
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content,
    };
  },
} satisfies ToolDef<InputSchema, Output>);
