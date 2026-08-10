// macOS Option+T emits U+2020 when the terminal does not map Option to Meta.
export const MACOS_OPTION_SPECIAL_CHARS = {
  '\u2020': 'alt+t',
} as const satisfies Record<string, string>

export function isMacosOptionChar(
  char: string,
): char is keyof typeof MACOS_OPTION_SPECIAL_CHARS {
  return char in MACOS_OPTION_SPECIAL_CHARS
}
