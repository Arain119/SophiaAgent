// biome-ignore-all assist/source/organizeImports: startup imports are grouped by responsibility
import * as React from 'react';
import { useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { getLogoDisplayPath, getRecentActivitySync, truncatePath } from '../../utils/logoV2Utils.js';
import { getGlobalConfig } from 'src/utils/config.js';
import { getInitialSettings } from 'src/utils/settings/settings.js';
import { isDebugMode, isDebugToStdErr, getDebugLogPath } from 'src/utils/debug.js';
import { getDisplayPath } from '../../utils/file.js';
import { getDumpPromptsPath } from 'src/services/api/dumpPrompts.js';
import { getStartupPerfLogPath, isDetailedProfilingEnabled } from 'src/utils/startupProfiler.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { selectSophiaStartupLogoWidth, SophiaAsciiLogo } from './WelcomeV2.js';
import { Feed } from './Feed.js';
import { createRecentActivityFeed } from './feedConfigs.js';
import { EmergencyTip } from './EmergencyTip.js';
import { GateOverridesWarning } from './GateOverridesWarning.js';
import { ExperimentEnrollmentNotice } from './ExperimentEnrollmentNotice.js';

export function LogoV2(): React.ReactNode {
  const { columns } = useTerminalSize();
  const showSandboxStatus = SandboxManager.isSandboxingEnabled();
  const config = getGlobalConfig();
  const activities = getRecentActivitySync();

  const [announcement] = useState(() => {
    const announcements = getInitialSettings().companyAnnouncements;
    if (!announcements || announcements.length === 0) return undefined;
    return config.numStartups === 1
      ? announcements[0]
      : announcements[Math.floor(Math.random() * announcements.length)];
  });

  const cwd = getLogoDisplayPath();
  const contentWidth = Math.max(1, columns - 4);
  const logoWidth = selectSophiaStartupLogoWidth(contentWidth);
  const panelWidth = Math.max(1, contentWidth - logoWidth - 3);
  const cwdLine = truncatePath(cwd, panelWidth);

  return (
    <>
      <OffscreenFreeze>
        <Box flexDirection="row" gap={3} paddingLeft={2} width={contentWidth + 2}>
          <SophiaAsciiLogo availableWidth={logoWidth} />
          <Box flexDirection="column" width={panelWidth}>
            <Text dimColor>{cwdLine}</Text>
            <Box marginTop={1}>
              <Feed config={createRecentActivityFeed(activities)} actualWidth={panelWidth} />
            </Box>
          </Box>
        </Box>
      </OffscreenFreeze>

      {isDebugMode() && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="warning">Debug mode enabled</Text>
          <Text dimColor>Logging to: {isDebugToStdErr() ? 'stderr' : getDebugLogPath()}</Text>
        </Box>
      )}
      <EmergencyTip />
      {process.env.SOPHIA_TMUX_SESSION && (
        <Box paddingLeft={2} flexDirection="column">
          <Text dimColor>tmux session: {process.env.SOPHIA_TMUX_SESSION}</Text>
          <Text dimColor>
            {process.env.SOPHIA_TMUX_PREFIX_CONFLICTS
              ? `Detach: ${process.env.SOPHIA_TMUX_PREFIX} ${process.env.SOPHIA_TMUX_PREFIX} d (press prefix twice - Sophia uses ${process.env.SOPHIA_TMUX_PREFIX})`
              : `Detach: ${process.env.SOPHIA_TMUX_PREFIX} d`}
          </Text>
        </Box>
      )}
      {announcement && (
        <Box paddingLeft={2}>
          <Text>{announcement}</Text>
        </Box>
      )}
      {showSandboxStatus && (
        <Box paddingLeft={2}>
          <Text color="warning">Shell sandbox is active.</Text>
        </Box>
      )}
      {process.env.USER_TYPE === 'ant' && !process.env.DEMO_VERSION && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="warning">[ANT-ONLY] Logs:</Text>
          <Text dimColor>API calls: {getDisplayPath(getDumpPromptsPath())}</Text>
          <Text dimColor>Debug logs: {getDisplayPath(getDebugLogPath())}</Text>
          {isDetailedProfilingEnabled() && (
            <Text dimColor>Startup Perf: {getDisplayPath(getStartupPerfLogPath())}</Text>
          )}
        </Box>
      )}
      {process.env.USER_TYPE === 'ant' && <GateOverridesWarning />}
      {process.env.USER_TYPE === 'ant' && <ExperimentEnrollmentNotice />}
    </>
  );
}
