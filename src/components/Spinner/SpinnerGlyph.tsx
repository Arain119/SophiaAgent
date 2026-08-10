import * as React from 'react';
import { Box, Text, useTheme } from '@anthropic/ink';
import { getTheme, type Theme } from '../../utils/theme.js';
import type { EffortLevel } from '../../utils/effort.js';
import type { RGBColor, SpinnerColor } from './types.js';
import { interpolateColor, parseRGB, resolveSpinnerColor, toRGBColor } from './utils.js';

export const MODEL_SPINNER_FRAMES = [
  '\u280b',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283c',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280f',
] as const;
export const MODEL_SPINNER_FRAME_MS = 80;
export const MODEL_SPINNER_WIDTH = 2;
export const EFFORT_WAVE_WIDTH = 11;

export const EFFORT_WAVE_RADIUS: Record<EffortLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

const EFFORT_DEPTH: Record<EffortLevel, number> = {
  low: 0,
  medium: 0.2,
  high: 0.45,
  xhigh: 0.72,
  max: 1,
};

const REDUCED_MOTION_CYCLE_MS = 2000;
const ERROR_RED = { r: 171, g: 43, b: 63 };

export type EffortWavePalette = {
  palePink: RGBColor;
  deepPink: RGBColor;
  paleBlue: RGBColor;
  deepBlue: RGBColor;
};

export const DEFAULT_EFFORT_WAVE_PALETTE: EffortWavePalette = {
  palePink: { r: 255, g: 218, b: 226 },
  deepPink: { r: 196, g: 78, b: 122 },
  paleBlue: { r: 191, g: 228, b: 255 },
  deepBlue: { r: 73, g: 154, b: 205 },
};

function themeRgb(value: string, fallback: RGBColor): RGBColor {
  return parseRGB(value) ?? fallback;
}

export function resolveEffortWavePalette(theme: Theme): EffortWavePalette {
  return {
    palePink: themeRgb(theme.sophiaPinkShimmer, DEFAULT_EFFORT_WAVE_PALETTE.palePink),
    deepPink: themeRgb(theme.sophiaPinkDeep, DEFAULT_EFFORT_WAVE_PALETTE.deepPink),
    paleBlue: themeRgb(theme.sophiaBlueShimmer, DEFAULT_EFFORT_WAVE_PALETTE.paleBlue),
    deepBlue: themeRgb(theme.sophiaBlue, DEFAULT_EFFORT_WAVE_PALETTE.deepBlue),
  };
}

type ModelSpinnerProps = {
  frame: number;
  messageColor: SpinnerColor;
  stalledIntensity?: number;
  reducedMotion?: boolean;
  time?: number;
};

export function ModelSpinnerGlyph({
  frame,
  messageColor,
  stalledIntensity = 0,
  reducedMotion = false,
  time = 0,
}: ModelSpinnerProps): React.ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  const isDim = reducedMotion && Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1;
  const glyph = reducedMotion
    ? '\u25cf'
    : MODEL_SPINNER_FRAMES[
        ((frame % MODEL_SPINNER_FRAMES.length) + MODEL_SPINNER_FRAMES.length) % MODEL_SPINNER_FRAMES.length
      ]!;

  let color: SpinnerColor = messageColor;
  if (stalledIntensity > 0) {
    const baseRGB = parseRGB(resolveSpinnerColor(messageColor, theme));
    color = baseRGB
      ? toRGBColor(interpolateColor(baseRGB, ERROR_RED, stalledIntensity))
      : stalledIntensity > 0.5
        ? 'error'
        : messageColor;
  }

  return (
    <Box flexWrap="wrap" height={1} width={MODEL_SPINNER_WIDTH}>
      <Text color={color} dimColor={isDim}>
        {glyph}
      </Text>
    </Box>
  );
}

type EffortWaveProps = {
  frame: number;
  effortLevel: EffortLevel;
  reducedMotion?: boolean;
  time?: number;
};

type Cell = {
  char: string;
  color: SpinnerColor;
};

export function getEffortWaveColor(
  effortLevel: EffortLevel,
  distance: number,
  crest: number,
  wake = 0,
  palette: EffortWavePalette = DEFAULT_EFFORT_WAVE_PALETTE,
): SpinnerColor {
  const maxRadius = EFFORT_WAVE_RADIUS[effortLevel];
  const distanceFade = Math.min(1, distance / Math.max(1, maxRadius * 3));
  const depth = EFFORT_DEPTH[effortLevel];
  const pinkDepth = Math.min(1, 0.08 + depth * 0.64 + crest * 0.34 - distanceFade * 0.1);
  const blueDepth = Math.min(1, 0.08 + depth * 0.3 + wake * 0.45 - distanceFade * 0.08);
  const pink = interpolateColor(palette.palePink, palette.deepPink, pinkDepth);
  const blue = interpolateColor(palette.paleBlue, palette.deepBlue, blueDepth);
  const pinkWeight = Math.min(1, Math.max(0, crest * 0.9 + depth * 0.12 - wake * 0.3));
  return toRGBColor(interpolateColor(blue, pink, pinkWeight));
}

function setCell(cells: Cell[], index: number, char: string, color: SpinnerColor): void {
  if (index >= 0 && index < cells.length) {
    cells[index] = { char, color };
  }
}

export function getEffortWaveParticleCount(effortLevel: EffortLevel): number {
  return 1 + EFFORT_WAVE_RADIUS[effortLevel] * 2;
}

export function EffortWave({ frame, effortLevel, reducedMotion = false, time = 0 }: EffortWaveProps): React.ReactNode {
  const [themeName] = useTheme();
  const palette = resolveEffortWavePalette(getTheme(themeName));
  const cells: Cell[] = Array.from({ length: EFFORT_WAVE_WIDTH }, () => ({
    char: ' ',
    color: getEffortWaveColor(effortLevel, 0, 0, 0, palette),
  }));
  const center = Math.floor(EFFORT_WAVE_WIDTH / 2);
  const maxRadius = EFFORT_WAVE_RADIUS[effortLevel];
  const phase = ((frame % 12) + 12) % 12;
  const isDim = reducedMotion && Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1;

  setCell(
    cells,
    center,
    reducedMotion ? '\u25c9' : phase % 4 < 2 ? '\u25c9' : '\u25c8',
    getEffortWaveColor(effortLevel, 0, 1, 0, palette),
  );

  for (let ring = 1; ring <= maxRadius; ring += 1) {
    const ripplePhase = reducedMotion ? 6 : (phase - ring * 2 + 12) % 12;
    const pulseDistance = Math.min(Math.abs(ripplePhase - 1), 12 - Math.abs(ripplePhase - 1));
    const crest = 1 - Math.min(1, pulseDistance / 4);
    const wake = 1 - Math.min(1, Math.abs(ripplePhase - 5) / 5);
    const particle = crest > 0.72 ? '\u25e6' : wake > 0.45 ? '\u2218' : '\u00b7';
    const color = getEffortWaveColor(effortLevel, ring, crest, wake, palette);
    setCell(cells, center - ring, particle, color);
    setCell(cells, center + ring, particle, color);
  }

  return (
    <Box flexWrap="wrap" height={1} width={EFFORT_WAVE_WIDTH}>
      {cells.map((cell, index) => (
        <Text key={index} color={cell.color} dimColor={isDim}>
          {cell.char}
        </Text>
      ))}
    </Box>
  );
}
