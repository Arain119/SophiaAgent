import { describe, expect, test } from 'bun:test'
import newSession from '../../src/commands/clear/index.ts'
import exit from '../../src/commands/exit/index.ts'
import resume from '../../src/commands/resume/index.ts'
import usage from '../../src/commands/usage/index.ts'
import { CORE_COMMAND_NAMES, CORE_TOOL_NAMES } from '../../src/coreSurface.ts'
import { getBuildFeatures } from '../defines.ts'

describe('Core command surface', () => {
  test('keeps a small, explicit built-in command set', () => {
    expect(CORE_COMMAND_NAMES).toHaveLength(6)
    expect(CORE_COMMAND_NAMES).not.toContain('permissions')
    expect(CORE_COMMAND_NAMES).not.toContain('mcp')
    expect(CORE_COMMAND_NAMES).not.toContain('plugin')
    expect(CORE_COMMAND_NAMES).not.toContain('workflows')
    expect(CORE_COMMAND_NAMES).not.toContain('job')
    expect(CORE_COMMAND_NAMES).not.toContain('skills')
    expect(CORE_COMMAND_NAMES).not.toContain('plan')
    expect(CORE_COMMAND_NAMES).not.toContain('agents')
    expect(CORE_COMMAND_NAMES).not.toContain('clear')
    expect(CORE_COMMAND_NAMES).not.toContain('compact')
    expect(CORE_COMMAND_NAMES).not.toContain('config')
    expect(CORE_COMMAND_NAMES).not.toContain('diff')
    expect(CORE_COMMAND_NAMES).not.toContain('doctor')
    expect(CORE_COMMAND_NAMES).not.toContain('init')
  })

  test('does not contain duplicate built-in command names', () => {
    expect(new Set(CORE_COMMAND_NAMES).size).toBe(CORE_COMMAND_NAMES.length)
  })

  test('ships one Core product without optional features', () => {
    expect(getBuildFeatures()).toEqual([])
  })

  test('keeps a focused model-facing Core tool contract', () => {
    expect(CORE_TOOL_NAMES).toHaveLength(24)
    expect(CORE_TOOL_NAMES).toContain('Agent')
    expect(CORE_TOOL_NAMES).toContain('Bash')
    expect(CORE_TOOL_NAMES).toContain('Read')
    expect(CORE_TOOL_NAMES).toContain('Edit')
    expect(CORE_TOOL_NAMES).toContain('WebBrowser')
    expect(CORE_TOOL_NAMES).toContain('Skill')
    expect(CORE_TOOL_NAMES).toContain('MCP')
    expect(CORE_TOOL_NAMES).toContain('Plugin')
    expect(CORE_TOOL_NAMES).not.toContain('TeamCreate')
    expect(CORE_TOOL_NAMES).toContain('Workflow')
    expect(CORE_TOOL_NAMES).toContain('CronCreate')
    expect(CORE_TOOL_NAMES).toContain('CronDelete')
    expect(CORE_TOOL_NAMES).toContain('CronList')
    expect(CORE_TOOL_NAMES).toContain('SSHRemote')
  })

  test('ships workflows and scheduling as unconditional Core tools', () => {
    expect(CORE_TOOL_NAMES).toContain('Workflow')
  })

  test('does not expose compatibility aliases', () => {
    for (const command of [newSession, exit, resume, usage]) {
      expect(command).not.toHaveProperty('aliases')
    }
  })
})
