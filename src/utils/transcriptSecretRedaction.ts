import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Message } from '../types/message.js'
import { setSshPassword } from './sshCredentials.js'

type CredentialWriter = (
  host: string,
  port: number,
  password: string,
) => unknown

const CREDENTIAL_VALUE =
  /(((?:password|passwd)\s*[:：=]\s*|密码\s*[:：=]?\s*))([^\s;；,，]+)/giu
const TOKEN_VALUE =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|gh[opsu]_[A-Za-z0-9]{16,})\b/g
const SSH_WITH_PASSWORD =
  /ssh\s+(?:-p\s+(\d+)\s+)?([^\s;；]+)[\s\S]*?(?:(?:password|passwd)\s*[:：=]\s*|密码\s*[:：=]?\s*)([^\s;；,，]+)/iu

export function redactSecretText(value: string): string {
  return value
    .replace(CREDENTIAL_VALUE, '$1[stored credential]')
    .replace(TOKEN_VALUE, '[redacted token]')
}

export function captureSshCredential(
  value: string,
  writeCredential: CredentialWriter = setSshPassword,
): void {
  const match = value.match(SSH_WITH_PASSWORD)
  if (!match) return
  const port = match[1] ? Number(match[1]) : 22
  const host = match[2]
  const password = match[3]
  if (
    !host ||
    !password ||
    password === '[stored credential]' ||
    !Number.isInteger(port)
  )
    return
  writeCredential(host, port, password)
}

function redactContentBlocks(
  content: ContentBlockParam[],
  writeCredential: CredentialWriter,
): ContentBlockParam[] {
  return content.map(block => {
    if (block.type === 'text') {
      captureSshCredential(block.text, writeCredential)
      return { ...block, text: redactSecretText(block.text) }
    }
    if (block.type === 'tool_use' && block.name === 'SSHRemote') {
      const input = block.input as Record<string, unknown>
      const host = typeof input.host === 'string' ? input.host : undefined
      const port = typeof input.port === 'number' ? input.port : 22
      const password =
        typeof input.password === 'string' ? input.password : undefined
      if (host && password) writeCredential(host, port, password)
      if (password) {
        return {
          ...block,
          input: { ...input, password: '[stored credential]' },
        }
      }
    }
    return block
  })
}

export function redactTranscriptSecrets(
  messages: Message[],
  writeCredential: CredentialWriter = setSshPassword,
): Message[] {
  return messages.map(message => {
    if (message.type !== 'user' && message.type !== 'assistant') return message
    const content = message.message?.content
    if (typeof content === 'string') {
      captureSshCredential(content, writeCredential)
      return {
        ...message,
        message: { ...message.message, content: redactSecretText(content) },
      } as Message
    }
    if (!Array.isArray(content)) return message
    return {
      ...message,
      message: {
        ...message.message,
        content: redactContentBlocks(
          content as ContentBlockParam[],
          writeCredential,
        ),
      },
    } as Message
  })
}
