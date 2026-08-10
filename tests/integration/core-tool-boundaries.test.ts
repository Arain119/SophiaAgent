import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectFile = (...parts: string[]) =>
  readFileSync(resolve(import.meta.dir, '..', '..', ...parts), 'utf8')

test('Core-facing permission and agent modules contain no deleted tool surfaces', () => {
  const toolRegistry = projectFile('src', 'tools.ts')

  expect(toolRegistry).not.toContain('NotebookEditTool')
  expect(toolRegistry).not.toContain('TungstenTool')
  expect(toolRegistry).not.toContain('MonitorTool')
  expect(toolRegistry).not.toContain('FULL_TOOL_SURFACE')

  expect(
    existsSync(
      resolve(
        import.meta.dir,
        '..',
        '..',
        'src',
        'components',
        'permissions',
        'PermissionRequest.tsx',
      ),
    ),
  ).toBe(false)

  const repl = projectFile('src', 'screens', 'REPL.tsx')
  const builtinToolsIndex = projectFile(
    'packages',
    'builtin-tools',
    'src',
    'index.ts',
  )
  expect(repl).not.toContain('TungstenLiveMonitor')
  expect(builtinToolsIndex).not.toContain('TungstenTool')
  expect(
    existsSync(
      resolve(
        import.meta.dir,
        '..',
        '..',
        'packages',
        'builtin-tools',
        'src',
        'tools',
        'TungstenTool',
        'TungstenTool.ts',
      ),
    ),
  ).toBe(false)
  expect(
    existsSync(
      resolve(
        import.meta.dir,
        '..',
        '..',
        'packages',
        'builtin-tools',
        'src',
        'tools',
        'TungstenTool',
        'TungstenLiveMonitor.ts',
      ),
    ),
  ).toBe(false)
})

test('REPL primitives contain only retained Core tools', () => {
  const toolRegistry = projectFile('src', 'tools.ts')
  const replPrimitives = projectFile(
    'packages',
    'builtin-tools',
    'src',
    'tools',
    'REPLTool',
    'primitiveTools.ts',
  )
  const replConstants = projectFile(
    'packages',
    'builtin-tools',
    'src',
    'tools',
    'REPLTool',
    'constants.ts',
  )
  expect(replPrimitives).not.toContain('NotebookEditTool')
  expect(replPrimitives).not.toContain('FULL_TOOL_SURFACE')
  expect(replConstants).not.toContain('NotebookEdit')
  expect(replConstants).not.toContain('FULL_TOOL_SURFACE')
  expect(toolRegistry).not.toContain('REPLTool')
  expect(toolRegistry).not.toContain('FULL_TOOL_SURFACE')
})
