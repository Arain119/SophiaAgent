import { mock } from 'bun:test'

function feature(name: string): boolean {
  const value = process.env[`FEATURE_${name}`]
  return value === '1' || value === 'true'
}

// Bun normalizes the compile-time `bun:bundle` import to `bundle` before
// regular test modules are resolved. Register both names so source imports
// and direct test imports share the same Core-default feature implementation.
mock.module('bundle', () => ({ feature }))
mock.module('bun:bundle', () => ({ feature }))
