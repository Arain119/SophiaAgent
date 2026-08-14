import { beforeEach, describe, expect, test } from 'bun:test'
import {
  planPythonHeredocPersistence,
  resetPythonHeredocPersistenceForTest,
} from '../pythonHeredocPersistence.js'

beforeEach(resetPythonHeredocPersistenceForTest)

describe('Python heredoc persistence', () => {
  test('keeps the first experiment inline and persists subsequent experiments', () => {
    const first = "python - <<'PY'\nprint('one')\nPY"
    const second = "python3 - <<'PY'\nprint('two')\nPY"
    expect(planPythonHeredocPersistence(first)).toEqual({ command: first })
    const planned = planPythonHeredocPersistence(second)
    expect(planned.command).toMatch(
      /^python3\s+'\.sophia\/experiments\/python-[a-f0-9]{16}\.py'$/,
    )
    expect(planned.script?.content).toBe("print('two')\n")
  })

  test('does not rewrite arbitrary or compound heredocs', () => {
    expect(
      planPythonHeredocPersistence("cat <<'EOF'\ntext\nEOF").script,
    ).toBeUndefined()
    expect(
      planPythonHeredocPersistence("python - <<'PY'\nprint(1)\nPY\necho done")
        .script,
    ).toBeUndefined()
  })

  test('uses a stable content fingerprint', () => {
    planPythonHeredocPersistence("python - <<'PY'\nprint(0)\nPY")
    const command = "python - <<'PY'\nprint(1)\nPY"
    const first = planPythonHeredocPersistence(command)
    const second = planPythonHeredocPersistence(command)
    expect(first.command).toBe(second.command)
  })
})
