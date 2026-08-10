import type { PipeMessage } from './pipeTransport.js'

type PipeRelayFn = (message: PipeMessage) => void

let pipeRelay: PipeRelayFn | null = null
let relayMuted = false

export function setRelayMuted(muted: boolean): void {
  relayMuted = muted
}

export function isRelayMuted(): boolean {
  return relayMuted
}

export function setPipeRelay(relay: PipeRelayFn | null): void {
  pipeRelay = relay
  if (!relay) relayMuted = false
}

export function getPipeRelay(): PipeRelayFn | null {
  return pipeRelay
}
