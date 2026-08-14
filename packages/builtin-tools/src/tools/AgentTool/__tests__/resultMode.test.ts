import { describe, expect, test } from 'bun:test'
import { AgentTool } from '../AgentTool.js'

function resultText(
  result: ReturnType<
    NonNullable<typeof AgentTool.mapToolResultToToolResultBlockParam>
  >,
): string {
  return Array.isArray(result.content)
    ? result.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
    : String(result.content)
}

describe('AgentTool result mode markers', () => {
  test('marks synchronous completion as inline and not pollable', () => {
    const result = AgentTool.mapToolResultToToolResultBlockParam!(
      {
        status: 'completed',
        content: [{ type: 'text', text: 'Finished the analysis.' }],
        agentId: 'agent-1',
        totalTokens: 10,
        totalToolUseCount: 1,
        totalDurationMs: 5,
        prompt: 'Analyze the code.',
        usage: {
          input_tokens: 6,
          output_tokens: 4,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: 'standard',
          cache_creation: null,
        },
      },
      'tool-use-1',
    )
    const text = resultText(result)

    expect(text).toContain('<agent_completion mode="inline">')
    expect(text).toContain('Do not call TaskOutput for this result.')
  })

  test('keeps asynchronous launch explicitly backgrounded', () => {
    const result = AgentTool.mapToolResultToToolResultBlockParam!(
      {
        status: 'async_launched',
        agentId: 'agent-2',
        description: 'Analyze code',
        prompt: 'Analyze the code.',
        outputFile: '/tmp/agent-2.output',
        canReadOutputFile: true,
      },
      'tool-use-2',
    )
    const text = resultText(result)

    expect(text).toContain('Async agent launched successfully.')
    expect(text).toContain('working in the background')
    expect(text).not.toContain('<agent_completion mode="inline">')
  })
})
