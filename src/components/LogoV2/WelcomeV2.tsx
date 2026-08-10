import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

export const SOPHIA_LOGO_COLOR = 'sophiaPink' as const;

export const SOPHIA_LOGO = [
  '░▒▓███████▓▒░░▒▓██████▓▒░░▒▓███████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓██████▓▒░',
  '░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░',
  '░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░',
  ' ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░▒▓█▓▒░▒▓████████▓▒░',
  '       ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░',
  '       ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░',
  '░▒▓███████▓▒░ ░▒▓██████▓▒░░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░',
] as const;

export const SOPHIA_COMPACT_LOGO = [
  '  ____   ___  ____  _   _ ___    _   ',
  ' / ___| / _ \\|  _ \\| | | |_ _|  / \\  ',
  ' \\___ \\| | | | |_) | |_| || |  / _ \\ ',
  '  ___) | |_| |  __/|  _  || | / ___ \\',
  ' |____/ \\___/|_|   |_| |_|___/_/   \\_\\',
] as const;

export const SOPHIA_MINI_LOGO = ['+----------------+', '|  SOPHIA AGENT  |', '+----------------+'] as const;

type SophiaAsciiLogoProps = {
  availableWidth?: number;
};

export function selectSophiaLogoLines(availableWidth: number): readonly string[] {
  if (availableWidth >= 80) return SOPHIA_LOGO;
  if (availableWidth >= 42) return SOPHIA_COMPACT_LOGO;
  return SOPHIA_MINI_LOGO;
}

export function selectSophiaStartupLogoWidth(contentWidth: number): number {
  if (contentWidth >= 108) return 80;
  if (contentWidth >= 64) return 42;
  return 18;
}

export function SophiaAsciiLogo({ availableWidth }: SophiaAsciiLogoProps): React.ReactNode {
  const { columns } = useTerminalSize();
  const width = availableWidth ?? Math.max(1, columns - 2);
  const lines = selectSophiaLogoLines(width);

  return (
    <Box flexDirection="column" width={Math.min(width, 80)}>
      {lines.map((line, index) => (
        <Text key={index} color={SOPHIA_LOGO_COLOR} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}

export function WelcomeV2(): React.ReactNode {
  const { columns } = useTerminalSize();
  const contentWidth = Math.max(1, Math.min(columns - 2, 104));

  return (
    <Box flexDirection="column" marginBottom={1} width={contentWidth}>
      <SophiaAsciiLogo availableWidth={contentWidth} />
    </Box>
  );
}
