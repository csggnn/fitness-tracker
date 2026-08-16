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

/**
 * The audio clock is not the system clock. It stops advancing while the context is suspended, which
 * a locked screen does routinely, so a queue anchored once fires late by however long it stalled.
 */
describe('resync', () => {
  /** Wall clock advances `elapsedMs`; the audio clock advances all but `stallMs` of it, and a
   * negative `stallMs` puts the audio clock ahead. */
  const runWithStall = (elapsedMs: number, stallMs: number): number => {
    ctx.currentTime = (elapsedMs - stallMs) / 1000
    return T0 + elapsedMs
  }

  it('reports the slip between the audio clock and the system clock', () => {
    const now = runWithStall(600_000, 3_000)
    expect(scheduler.driftMs(now)).toBeCloseTo(3_000, 5)
  })

  it('leaves the queue untouched while the clocks agree', () => {
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    const before = scheduler.scheduledCount
    const now = runWithStall(300_000, 0)

    expect(scheduler.resync(grid(), 5, TOTAL_SLOTS, now)).toBe(false)
    expect(scheduler.scheduledCount).toBe(before)
    expect(scheduler.resyncCount).toBe(0)
  })

  it('ignores a slip smaller than one correction is worth', () => {
    scheduler.rebuild(grid(), 0, TOTAL_SLOTS)
    const now = runWithStall(300_000, 100)
    expect(scheduler.resync(grid(), 5, TOTAL_SLOTS, now)).toBe(false)
  })

  it('re-anchors the remaining pings to the system clock after a stall', () => {
    const g = grid()
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    // Ten slots in, with the audio clock 3s behind: every queued ping is 3s late.
    const now = runWithStall(10 * SLOT, 3_000)

    expect(scheduler.resync(g, 11, TOTAL_SLOTS, now)).toBe(true)
    expect(scheduler.resyncCount).toBe(1)

    const live = ctx.nodes.filter((n) => n.kind === 'osc' && !n.disconnected)
    const first = Math.min(...live.map((n) => n.startedAt!))
    // Slot 11 is one slot away on the system clock, so it must be one slot away on the audio one.
    const secondsFromNow = first - ctx.currentTime
    expect(secondsFromNow).toBeCloseTo(SLOT / 1000, 5)
  })

  it('does not requeue a slot the caller has already passed', () => {
    const g = grid()
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    // Audio clock 3s ahead: the pings for the slots already passed would land in the future, and
    // requeueing one is a doubled cue rather than a late one.
    const now = runWithStall(10 * SLOT, -3_000)
    expect(scheduler.resync(g, 11, TOTAL_SLOTS, now)).toBe(true)

    const live = ctx.nodes.filter((n) => n.kind === 'osc' && !n.disconnected)
    const earliest = Math.min(...live.map((n) => n.startedAt!))
    expect(earliest - ctx.currentTime).toBeCloseTo(SLOT / 1000, 5)
  })

  it('lets a ping that is already sounding finish', () => {
    const g = grid()
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    // Slot 1 is sounding on the audio clock; the wall clock is 3s further on.
    const soundingAt = ctx.nodes.filter((n) => n.kind === 'osc' && n.startedAt === SLOT / 1000)
    ctx.currentTime = SLOT / 1000 + 0.01
    scheduler.resync(g, 2, TOTAL_SLOTS, T0 + SLOT + 3_000)

    // Every oscillator is handed a stop time when it is scheduled, so a cut shows as a disconnect.
    expect(soundingAt).not.toHaveLength(0)
    expect(soundingAt.every((n) => !n.disconnected)).toBe(true)
  })

  it('keeps one queue live across repeated corrections', () => {
    const g = grid()
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    for (let i = 1; i <= 3; i++) {
      scheduler.resync(g, 1, TOTAL_SLOTS, runWithStall(i * 10_000, i * 500))
    }
    expect(ctx.nodes.filter((n) => !n.disconnected)).toHaveLength(scheduler.scheduledCount)
  })

  it('schedules nothing while paused', () => {
    const g = grid()
    scheduler.rebuild(g, 0, TOTAL_SLOTS)
    const now = runWithStall(10 * SLOT, 3_000)
    expect(scheduler.resync({ ...g, pausedAt: now }, 11, TOTAL_SLOTS, now)).toBe(false)
  })
})
