import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import React from 'react'
import { wrappedRender } from '@anthropic/ink'
import {
  SOPHIA_COMPACT_LOGO,
  SOPHIA_LOGO,
  SOPHIA_MINI_LOGO,
  SophiaAsciiLogo,
  selectSophiaLogoLines,
  selectSophiaStartupLogoWidth,
} from '../WelcomeV2.js'

describe('responsive Sophia startup logo', () => {
  test('uses the full BlurVision logo when it fits', () => {
    expect(selectSophiaLogoLines(120)).toBe(SOPHIA_LOGO)
    expect(selectSophiaLogoLines(80)).toBe(SOPHIA_LOGO)
  })

  test('uses a compact ASCII wordmark without truncating the full logo', () => {
    expect(selectSophiaLogoLines(79)).toBe(SOPHIA_COMPACT_LOGO)
    expect(selectSophiaLogoLines(42)).toBe(SOPHIA_COMPACT_LOGO)
  })

  test('uses the minimal mark for narrow terminals', () => {
    expect(selectSophiaLogoLines(41)).toBe(SOPHIA_MINI_LOGO)
    expect(selectSophiaLogoLines(20)).toBe(SOPHIA_MINI_LOGO)
  })

  test('every variant fits its activation width', () => {
    expect(
      Math.max(...SOPHIA_LOGO.map(line => line.length)),
    ).toBeLessThanOrEqual(80)
    expect(
      Math.max(...SOPHIA_COMPACT_LOGO.map(line => line.length)),
    ).toBeLessThanOrEqual(42)
    expect(
      Math.max(...SOPHIA_MINI_LOGO.map(line => line.length)),
    ).toBeLessThanOrEqual(20)
  })

  test('reserves space for the activity panel beside the startup logo', () => {
    expect(selectSophiaStartupLogoWidth(108)).toBe(80)
    expect(selectSophiaStartupLogoWidth(107)).toBe(42)
    expect(selectSophiaStartupLogoWidth(64)).toBe(42)
    expect(selectSophiaStartupLogoWidth(63)).toBe(18)
  })

  test('renders each responsive variant without substituting another wordmark', async () => {
    for (const [width, expected] of [
      [80, SOPHIA_LOGO],
      [42, SOPHIA_COMPACT_LOGO],
      [20, SOPHIA_MINI_LOGO],
    ] as const) {
      const stdout = new PassThrough() as PassThrough & {
        columns: number
        rows: number
      }
      stdout.columns = width
      stdout.rows = 30
      let output = ''
      stdout.on('data', chunk => {
        output += chunk.toString()
      })

      const instance = await wrappedRender(
        React.createElement(SophiaAsciiLogo, { availableWidth: width }),
        {
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      )
      await new Promise(resolve => setTimeout(resolve, 10))
      instance.unmount()
      instance.cleanup()

      expect(output).toContain(expected[0]!.trimEnd())
      expect(output).toContain(expected.at(-1)!.trimEnd())
    }
  })
})
