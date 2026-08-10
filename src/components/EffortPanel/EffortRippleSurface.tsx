import * as React from 'react';
import { Box, Text, useTheme } from '@anthropic/ink';
import { getTheme } from '../../utils/theme.js';
import type { EffortLevel } from '../../utils/effort.js';
import {
  DEFAULT_EFFORT_WAVE_PALETTE,
  EFFORT_WAVE_RADIUS,
  getEffortWaveColor,
  resolveEffortWavePalette,
  type EffortWavePalette,
} from '../Spinner/SpinnerGlyph.js';
import type { SpinnerColor } from '../Spinner/types.js';
import { PANEL_POSITIONS, type PanelPosition } from './effortPanelState.js';

const SURFACE_HEIGHT = 9;
const SOURCE_ROW = 6;
const RIPPLE_CYCLE_MS = 1600;
const PARTICLES = ['\u00b7', '\u02d9', '\u2219', '\u2218', '\u25e6', '\u2022'] as const;

export const EFFORT_RIPPLE_CONFIG: Record<
  EffortLevel,
  {
    rings: number;
    density: number;
    thickness: number;
    wake: number;
    reach: number;
    speed: number;
    sparkle: number;
  }
> = {
  low: { rings: 1, density: 0.1, thickness: 1.25, wake: 0.25, reach: 0.55, speed: 0.82, sparkle: 0.08 },
  medium: { rings: 2, density: 0.14, thickness: 1.5, wake: 0.32, reach: 0.78, speed: 0.9, sparkle: 0.11 },
  high: { rings: 3, density: 0.19, thickness: 1.8, wake: 0.4, reach: 1, speed: 1, sparkle: 0.15 },
  xhigh: { rings: 4, density: 0.25, thickness: 2.1, wake: 0.48, reach: 1.12, speed: 1.08, sparkle: 0.2 },
  max: { rings: 5, density: 0.32, thickness: 2.45, wake: 0.56, reach: 1.24, speed: 1.16, sparkle: 0.26 },
};

type Cell = {
  char: string;
  color: SpinnerColor;
  bold: boolean;
  source: boolean;
};

export type EffortRippleSegment = {
  text: string;
  color: SpinnerColor;
  bold: boolean;
};

type RippleSignal = {
  crest: number;
  wake: number;
  halo: number;
  ring: number;
};

function emptyRow(width: number): Cell[] {
  return Array.from({ length: width }, () => ({
    char: ' ',
    color: 'subtle',
    bold: false,
    source: false,
  }));
}

function write(row: Cell[], start: number, value: string, color: SpinnerColor, bold = false, source = false): void {
  for (let index = 0; index < value.length; index += 1) {
    const target = start + index;
    if (target < 0 || target >= row.length) continue;
    row[target] = { char: value[index]!, color, bold, source };
  }
}

function centeredStart(segmentWidth: number, index: number, text: string): number {
  return index * segmentWidth + Math.max(0, Math.floor((segmentWidth - text.length) / 2));
}

export function getEffortRippleOrigin(segmentWidth: number, cursor: PanelPosition): { x: number; y: number } {
  const index = PANEL_POSITIONS.indexOf(cursor);
  return {
    x: index * segmentWidth + Math.floor(segmentWidth / 2),
    y: SOURCE_ROW,
  };
}

function hashCell(x: number, y: number, ring: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + ring * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function smoothPulse(distance: number, center: number, width: number): number {
  const normalized = Math.abs(distance - center) / Math.max(0.01, width);
  if (normalized >= 1) return 0;
  const curved = 1 - normalized * normalized;
  return curved * curved;
}

function rippleSignal(
  distance: number,
  maxDistance: number,
  elapsed: number,
  effortLevel: EffortLevel,
  reducedMotion: boolean,
): RippleSignal {
  const config = EFFORT_RIPPLE_CONFIG[effortLevel];
  if (reducedMotion) {
    const radius = 3 + EFFORT_WAVE_RADIUS[effortLevel] * 1.5;
    return {
      crest: Math.max(0, 1 - distance / radius),
      wake: Math.max(0, 1 - distance / (radius * 1.7)) * config.wake,
      halo: 0,
      ring: 0,
    };
  }

  const cycle = RIPPLE_CYCLE_MS / config.speed;
  const emissionGap = cycle / Math.max(2.2, config.rings + 0.8);
  const travelDistance = maxDistance * config.reach;
  let strongestCrest = 0;
  let strongestWake = 0;
  let strongestRing = 0;

  for (let ring = 0; ring < config.rings; ring += 1) {
    const age = elapsed - ring * emissionGap;
    if (age < 0) continue;
    const progress = (age % cycle) / cycle;
    const front = progress * (travelDistance + config.thickness * 2);
    const life = 1 - progress * 0.58;
    const crest = smoothPulse(distance, front, config.thickness) * life;
    const wakeRadius = front - config.thickness * 2.2;
    const wake = smoothPulse(distance, wakeRadius, config.thickness * 2.8) * life * config.wake;
    if (crest + wake > strongestCrest + strongestWake) {
      strongestCrest = crest;
      strongestWake = wake;
      strongestRing = ring;
    }
  }

  const sourceRadius = 3.4 + EFFORT_WAVE_RADIUS[effortLevel] * 0.55;
  const sourcePulse = 0.55 + 0.45 * Math.sin((elapsed / (620 / config.speed)) * Math.PI * 2);
  const halo = Math.max(0, 1 - distance / sourceRadius) * (0.12 + sourcePulse * 0.12);
  return { crest: strongestCrest, wake: strongestWake, halo, ring: strongestRing };
}

function buildBaseRows(
  width: number,
  segmentWidth: number,
  cursor: PanelPosition,
  status: string,
  palette: EffortWavePalette,
  envText?: string,
): Cell[][] {
  const rows = Array.from({ length: SURFACE_HEIGHT }, () => emptyRow(width));
  write(rows[0]!, 0, 'Effort', 'sophiaPink', true);
  if (envText) write(rows[1]!, 0, envText.slice(0, width), 'warning');
  write(rows[2]!, 0, 'Faster', 'sophiaBlue');
  write(rows[2]!, Math.max(0, width - 'Deeper'.length), 'Deeper', 'sophiaPink');

  PANEL_POSITIONS.forEach((position, index) => {
    const selected = position === cursor;

    write(
      rows[SOURCE_ROW]!,
      centeredStart(segmentWidth, index, position),
      position,
      selected ? getEffortWaveColor(cursor, 0, 1, 0, palette) : 'subtle',
      selected,
      selected,
    );
  });
  write(rows[8]!, 0, status.slice(0, width), 'sophiaBlue');
  return rows;
}

function toSegments(row: Cell[]): EffortRippleSegment[] {
  const segments: EffortRippleSegment[] = [];
  for (const cell of row) {
    const previous = segments[segments.length - 1];
    if (previous && previous.color === cell.color && previous.bold === cell.bold) {
      previous.text += cell.char;
    } else {
      segments.push({ text: cell.char, color: cell.color, bold: cell.bold });
    }
  }
  return segments;
}

function selectParticle(crest: number, wake: number, halo: number, noise: number): string {
  if (crest > 0.78) return noise > 0.72 ? '\u2022' : '\u25e6';
  if (crest > 0.42) return noise > 0.6 ? '\u25e6' : '\u2218';
  if (wake > 0.22) return noise > 0.55 ? '\u2219' : '\u02d9';
  if (halo > 0.1) return '\u00b7';
  const index = Math.min(PARTICLES.length - 1, Math.floor(noise * PARTICLES.length));
  return PARTICLES[index]!;
}

export function createEffortRippleRows(args: {
  width: number;
  segmentWidth: number;
  cursor: PanelPosition;
  elapsed: number;
  reducedMotion: boolean;
  status: string;
  envText?: string;
  palette?: EffortWavePalette;
}): EffortRippleSegment[][] {
  const { width, segmentWidth, cursor, elapsed, reducedMotion, status, envText } = args;
  const palette = args.palette ?? DEFAULT_EFFORT_WAVE_PALETTE;
  const rows = buildBaseRows(width, segmentWidth, cursor, status, palette, envText);
  const origin = getEffortRippleOrigin(segmentWidth, cursor);
  const maxDistance = Math.hypot(
    Math.max(origin.x, width - 1 - origin.x),
    Math.max(origin.y, SURFACE_HEIGHT - 1 - origin.y) * 2.2,
  );
  const config = EFFORT_RIPPLE_CONFIG[cursor];
  const driftFrame = Math.floor(elapsed / 180);

  rows.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell.source) return;
      const distance = Math.hypot(x - origin.x, (y - origin.y) * 2.2);
      const signal = rippleSignal(distance, maxDistance, elapsed, cursor, reducedMotion);
      const intensity = Math.max(signal.crest, signal.wake, signal.halo);
      if (intensity <= 0.045) return;

      cell.color = getEffortWaveColor(cursor, distance, signal.crest + signal.halo * 0.5, signal.wake, palette);
      if (cell.char !== ' ') return;

      const drift = signal.ring % 2 === 0 ? driftFrame : -driftFrame;
      const occupancyNoise = hashCell(x + drift, y, signal.ring);
      const glyphNoise = hashCell(x - drift * 0.5 + 19, y + 11, signal.ring + 7);
      const sparkleNoise = hashCell(x + 37, y - drift + 23, signal.ring + 13);
      const probability =
        config.density * (signal.crest * 1.25 + signal.wake * 0.72 + signal.halo * 0.35) * (0.76 + sparkleNoise * 0.38);
      if (occupancyNoise < probability) {
        cell.char = selectParticle(signal.crest, signal.wake, signal.halo, glyphNoise);
        cell.bold = signal.crest > 0.58 && sparkleNoise < config.sparkle;
      }
    });
  });

  return rows.map(toSegments);
}

export function EffortRippleSurface(props: {
  width: number;
  segmentWidth: number;
  cursor: PanelPosition;
  elapsed: number;
  reducedMotion: boolean;
  status: string;
  envText?: string;
}): React.ReactNode {
  const [themeName] = useTheme();
  const rows = createEffortRippleRows({
    ...props,
    palette: resolveEffortWavePalette(getTheme(themeName)),
  });
  return (
    <Box flexDirection="column" height={SURFACE_HEIGHT} width={props.width}>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} height={1} width={props.width}>
          {row.map((segment, segmentIndex) => (
            <Text key={segmentIndex} bold={segment.bold} color={segment.color}>
              {segment.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
