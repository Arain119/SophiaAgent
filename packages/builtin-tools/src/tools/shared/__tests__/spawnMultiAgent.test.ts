import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTeammateModel, spawnTeammate } from '../spawnMultiAgent'

let tempHome: string
let previousConfigDir: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.SOPHIA_CONFIG_DIR
  tempHome = join(
    tmpdir(),
    `spawn-multi-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.SOPHIA_CONFIG_DIR = tempHome
})

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.SOPHIA_CONFIG_DIR
  } else {
    process.env.SOPHIA_CONFIG_DIR = previousConfigDir
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('spawnTeammate', () => {
  test('routes teammates to the configured subagent default', () => {
    expect(resolveTeammateModel(undefined, 'gpt-5.6-sol')).toBe('gpt-5.6-luna')
    expect(resolveTeammateModel('gpt-5.6-sol', 'gpt-5.6-sol')).toBe(
      'gpt-5.6-luna',
    )
  })

  test('fails before spawn side effects when the team file is missing', async () => {
    let setAppStateCalled = false
    const context = {
      getAppState: () => ({
        teamContext: undefined,
      }),
      setAppState: () => {
        setAppStateCalled = true
      },
      options: {
        agentDefinitions: {
          activeAgents: [],
        },
      },
    }

    await expect(
      spawnTeammate(
        {
          name: 'worker',
          prompt: 'do work',
          team_name: 'missing-team',
        },
        context as any,
      ),
    ).rejects.toThrow('Team "missing-team" does not exist')
    expect(setAppStateCalled).toBe(false)
  })
})
