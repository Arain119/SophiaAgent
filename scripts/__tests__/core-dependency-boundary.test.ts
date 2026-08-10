import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function readRepoFile(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    'utf8',
  )
}

describe('Core dependency boundary', () => {
  test('keeps optional commands behind supported extension features', () => {
    const coreRegistry = readRepoFile('src/commands.ts')
    const staticCommandImports = coreRegistry.match(
      /^import .*['"]\.\/commands\//gm,
    )

    expect(staticCommandImports?.length).toBe(6)
    expect(coreRegistry).not.toContain("feature('BRIDGE_MODE')")
    expect(coreRegistry).not.toContain('./commands/workflows/')
    expect(coreRegistry).not.toContain('./commands/plugin/')
    expect(coreRegistry).not.toContain('./commands/mcp/')
    expect(coreRegistry).not.toContain('./commands/job/')
    expect(coreRegistry).not.toContain('extensionSurface')
    expect(coreRegistry).not.toContain('FULL_COMMAND_SURFACE')
    expect(coreRegistry).not.toContain('VOICE_MODE')
    expect(coreRegistry).not.toContain('COORDINATOR_MODE')
    expect(coreRegistry).not.toContain("feature('GOAL')")
    expect(coreRegistry).not.toContain("feature('BUDDY')")
  })

  test('keeps workflow and cron in Core without legacy tool loaders', () => {
    const coreRegistry = readRepoFile('src/tools.ts')

    expect(coreRegistry).toContain('createWorkflowToolCore()')
    expect(coreRegistry).toContain('ScheduleCronTool/CronCreateTool.js')
    expect(coreRegistry).toContain('ScheduleCronTool/CronDeleteTool.js')
    expect(coreRegistry).toContain('ScheduleCronTool/CronListTool.js')
    expect(coreRegistry).not.toContain('FULL_TOOL_SURFACE')
    expect(coreRegistry).not.toContain('NotebookEditTool/NotebookEditTool.js')
    expect(coreRegistry).not.toContain('ArtifactTool/ArtifactTool.js')
    expect(coreRegistry).not.toContain('RemoteTriggerTool')
    expect(coreRegistry).not.toContain('MonitorTool')
  })
})
