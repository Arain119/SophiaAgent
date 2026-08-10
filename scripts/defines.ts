import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

/** Shared MACRO define map used by both development and build entrypoints. */
export function getMacroDefines(): Record<string, string> {
  return {
    'MACRO.VERSION': JSON.stringify(pkg.version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(''),
    'MACRO.PACKAGE_URL': JSON.stringify(''),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
  }
}

/** Sophia Core has no optional compile-time features. */
export const BUILD_FEATURES: readonly string[] = []

export function getBuildFeatures(): string[] {
  return [...BUILD_FEATURES]
}
