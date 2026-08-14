import { describe, expect, test } from 'bun:test'
import { sanitizeTextForPersistence } from '../persistenceSanitization.js'
import { repairMojibake } from '../textEncoding.js'

describe('persistence sanitization', () => {
  test('repairs reversible UTF-8 decoded as GBK', () => {
    expect(repairMojibake('缁撴灉')).toBe('结果')
    expect(repairMojibake('楠岃瘉')).toBe('验证')
  })

  test('preserves valid Chinese and unrelated text', () => {
    expect(repairMojibake('最新动态会全部展开吗')).toBe('最新动态会全部展开吗')
    expect(repairMojibake('plain text')).toBe('plain text')
  })

  test('repairs then redacts before persistence', () => {
    const value = sanitizeTextForPersistence('瀵嗙爜: do-not-store')
    expect(value).toContain('密码: [stored credential]')
    expect(value).not.toContain('do-not-store')
  })
})
