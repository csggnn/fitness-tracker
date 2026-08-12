import { beforeEach, describe, expect, it } from 'vitest'
import { PingScheduler } from './audio'
import type { Grid } from './grid'

/**
 * A leaked node is inaudible in a unit test and wrong only on the gym floor, so the stub records
 * every node it hands out and whether it was stopped and disconnected.
 */
interface FakeNode {
  kind: 'osc' | 'gain'
  startedAt?: number
  stopped: boolean
  disconnected: boolean
}

class FakeAudioContext {
  currentTime = 0
  sampleRate = 48_000
  state: AudioContextState = 'running'
  destination = {} as AudioDestinationNode
  nodes: FakeNode[] = []

  createOscillator() {
    const node: FakeNode = { kind: 'osc', stopped: false, disconnected: false }
    this.nodes.push(node)
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect: () => undefined,
      disconnect: () => {
        node.disconnected = true
      },
      start: (when: number) => {
        node.startedAt = when
      },
      stop: () => {
        node.stopped = true
      },
    }
  }

  createGain() {
    const node: FakeNode = { kind: 'gain', stopped: false, disconnected: false }
    this.nodes.push(node)
    return {
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
      disconnect: () => {
        node.disconnected = true
      },
    }
  }

  createBuffer() {
    return {} as AudioBuffer
  }

  createBufferSource() {
    return {
      buffer: null,
      loop: false,
      connect: () => undefined,
      disconnect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }
  }

  async resume() {
    this.state = 'running'
  }

  async close() {
    this.state = 'closed'
  }
}

const T0 = 1_700_000_000_000
const SLOT = 75_000
const TOTAL_SLOTS = 26

let ctx: FakeAudioContext
let scheduler: PingScheduler

beforeEach(() => {
  ctx = new FakeAudioContext()
  scheduler = new PingScheduler(ctx as unknown as AudioContext, T0)
})

const grid = (anchorMs = T0): Grid => ({ anchorMs, slotMs: SLOT })

describe('scheduling', () => {
  it('queues every remaining ping up front rather than a lookahead window', () => {
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    // Slot 0 is already due at ctx.currentTime and is dropped; 25 pings remain.
    const oscillators = ctx.nodes.filter((n) => n.kind === 'osc')
    // 13 A pings are a double beep, 13 B pings a single one, less the dropped first A.
    expect(oscillators).toHaveLength(12 * 2 + 13 * 1)
  })

  it('places pings on the grid, not on wall-clock render time', () => {
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    const starts = ctx.nodes.filter((n) => n.kind === 'osc').map((n) => n.startedAt!)
    // First scheduled ping is slot 1, one slot length out, in seconds on the audio clock.
    expect(starts[0]).toBeCloseTo(75, 5)
    expect(Math.max(...starts)).toBeCloseTo((TOTAL_SLOTS - 1) * 75, 5)
  })

  it('drops pings that have already passed', () => {
    ctx.currentTime = 10 * (SLOT / 1000)
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    const starts = ctx.nodes.filter((n) => n.kind === 'osc').map((n) => n.startedAt!)
    expect(Math.min(...starts)).toBeGreaterThan(ctx.currentTime)
  })

  it('schedules nothing while paused', () => {
    scheduler.rebuild({ ...grid(), pausedAt: T0 + 1_000 }, 0, TOTAL_SLOTS)
    expect(scheduler.scheduledCount).toBe(0)
  })
})

describe('rebuild', () => {
  it('stops and disconnects every previously scheduled node', () => {
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    const firstBatch = [...ctx.nodes]
    expect(firstBatch.length).toBeGreaterThan(0)

    scheduler.rebuild(grid(T0 + 30_000), 0, TOTAL_SLOTS)

    for (const node of firstBatch) {
      expect(node.disconnected).toBe(true)
      if (node.kind === 'osc') expect(node.stopped).toBe(true)
    }
  })

  it('leaves exactly one queue live after repeated rebuilds', () => {
    // Same anchor throughout: a moved anchor changes how many pings are still in the future,
    // which would mask an accumulating queue rather than expose it.
    const g = grid(T0 + 1_000)
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    const afterFirst = scheduler.scheduledCount
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    expect(scheduler.scheduledCount).toBe(afterFirst)
    expect(ctx.nodes.filter((n) => !n.disconnected)).toHaveLength(afterFirst)
  })

  it('cancels the queue outright on pause', () => {
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    scheduler.cancelAll()
    expect(scheduler.scheduledCount).toBe(0)
    expect(ctx.nodes.every((n) => n.disconnected)).toBe(true)
  })

  it('resumes only the slots that have not fired', () => {
    scheduler.rebuild(grid(), 20, TOTAL_SLOTS)
    const starts = ctx.nodes.filter((n) => n.kind === 'osc').map((n) => n.startedAt!)
    expect(Math.min(...starts)).toBeCloseTo(20 * 75, 5)
  })
})
