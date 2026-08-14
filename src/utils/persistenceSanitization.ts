import { redactSecretText } from './transcriptSecretRedaction.js'
import { repairMojibake } from './textEncoding.js'

export function sanitizeTextForPersistence(value: string): string {
  return redactSecretText(repairMojibake(value))
}
