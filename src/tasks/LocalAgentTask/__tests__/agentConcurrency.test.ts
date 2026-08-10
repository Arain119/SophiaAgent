import { describe, expect, test } from 'bun:test'
import {
  acquireAgentPermit,
  getAgentConcurrencySnapshot,
  resetAgentConcurrencyForTest,
} from '../agentConcurrency.js'

describe('agentConcurrency', () => {
  test('queues agents above the process concurrency limit', async () => {
    resetAgentConcurrencyForTest()
    const controller = new AbortController()
    const releases = await Promise.all([
      acquireAgentPermit(controller.signal),
      acquireAgentPermit(controller.signal),
      acquireAgentPermit(controller.signal),
    ])
    let fourthStarted = false
    const fourth = acquireAgentPermit(controller.signal).then(release => {
      fourthStarted = true
      return release
    })
    await Promise.resolve()
    expect(getAgentConcurrencySnapshot()).toEqual({
      active: 3,
      queued: 1,
      limit: 3,
    })
    expect(fourthStarted).toBe(false)
    releases[0]!()
    const releaseFourth = await fourth
    expect(fourthStarted).toBe(true)
    releases.slice(1).forEach(release => release())
    releaseFourth()
  })

  test('removes an aborted queued agent without consuming a permit', async () => {
    resetAgentConcurrencyForTest()
    const activeController = new AbortController()
    const releases = await Promise.all([
      acquireAgentPermit(activeController.signal),
      acquireAgentPermit(activeController.signal),
      acquireAgentPermit(activeController.signal),
    ])
    const queuedController = new AbortController()
    const queued = acquireAgentPermit(queuedController.signal)
    queuedController.abort()
    await expect(queued).rejects.toThrow('aborted')
    expect(getAgentConcurrencySnapshot().queued).toBe(0)
    releases.forEach(release => release())
  })
})
