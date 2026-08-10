// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { getLargeMemoryFiles, MAX_MEMORY_CHARACTER_COUNT, type MemoryFileInfo } from './claudemd.js';
import figures from 'figures';
import { getCwd } from './cwd.js';
import { relative } from 'path';
import { formatNumber } from './format.js';
import type { getGlobalConfig } from './config.js';
import type { AgentDefinitionsResult } from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { getAgentDescriptionsTotalTokens, AGENT_DESCRIPTIONS_THRESHOLD } from './statusNoticeHelpers.js';

// Types
export type StatusNoticeType = 'warning' | 'info';

export type StatusNoticeContext = {
  config: ReturnType<typeof getGlobalConfig>;
  agentDefinitions?: AgentDefinitionsResult;
  memoryFiles: MemoryFileInfo[];
};

export type StatusNoticeDefinition = {
  id: string;
  type: StatusNoticeType;
  isActive: (context: StatusNoticeContext) => boolean;
  render: (context: StatusNoticeContext) => React.ReactNode;
};

// Individual notice definitions
const largeMemoryFilesNotice: StatusNoticeDefinition = {
  id: 'large-memory-files',
  type: 'warning',
  isActive: ctx => getLargeMemoryFiles(ctx.memoryFiles).length > 0,
  render: ctx => {
    const largeMemoryFiles = getLargeMemoryFiles(ctx.memoryFiles);
    return (
      <>
        {largeMemoryFiles.map(file => {
          const displayPath = file.path.startsWith(getCwd()) ? relative(getCwd(), file.path) : file.path;

          return (
            <Box key={file.path} flexDirection="row">
              <Text color="warning">{figures.warning}</Text>
              <Text color="warning">
                Large <Text bold>{displayPath}</Text> will impact performance ({formatNumber(file.content.length)} chars
                &gt; {formatNumber(MAX_MEMORY_CHARACTER_COUNT)})<Text dimColor> · /memory to edit</Text>
              </Text>
            </Box>
          );
        })}
      </>
    );
  },
};

const largeAgentDescriptionsNotice: StatusNoticeDefinition = {
  id: 'large-agent-descriptions',
  type: 'warning',
  isActive: context => {
    const totalTokens = getAgentDescriptionsTotalTokens(context.agentDefinitions);
    return totalTokens > AGENT_DESCRIPTIONS_THRESHOLD;
  },
  render: context => {
    const totalTokens = getAgentDescriptionsTotalTokens(context.agentDefinitions);
    return (
      <Box flexDirection="row">
        <Text color="warning">{figures.warning}</Text>
        <Text color="warning">
          Large cumulative agent descriptions will impact performance (~
          {formatNumber(totalTokens)} tokens &gt; {formatNumber(AGENT_DESCRIPTIONS_THRESHOLD)})
          <Text dimColor> · review .sophia/agents and plugin agents</Text>
        </Text>
      </Box>
    );
  },
};

// All notice definitions
export const statusNoticeDefinitions: StatusNoticeDefinition[] = [largeMemoryFilesNotice, largeAgentDescriptionsNotice];

// Helper functions for external use
export function getActiveNotices(context: StatusNoticeContext): StatusNoticeDefinition[] {
  return statusNoticeDefinitions.filter(notice => notice.isActive(context));
}
