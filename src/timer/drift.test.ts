import { describe, expect, it } from 'vitest'
import { PingScheduler } from './audio'
import { slotIndex, type Grid } from './grid'

/**
 * A whole session simulated against an audio clock that behaves like a real one: it runs at its
 * own rate and stops advancing while the context is suspended, which is what a locked screen does.
 *
 * The unit tests cover one correction. This covers what the gym floor sees: the error between the
 * beep the user hears and the countdown the user reads, sampled over every ping of a session.
 */

const T0 = 1_700_000_000_000
const SLOT = 75_000
const TOTAL_SLOTS = 26
const TICK_MS = 200
/** Resolution of the simulation, and therefore of every measurement it produces. */
const STEP_MS = 10

/** Hardware clock error. Real parts are tens of ppm; this is exaggerated to force corrections. */
const RATE_ERROR = 200e-6

/** The screen locks 6 minutes in and the session is picked up again 3 seconds later. */
const SUSPEND_FROM = T0 + 360_000
const SUSPEND_MS = 3_000

interface FiredBeep {
  startsAt: number
  firedAtWall: number
}

class SimOscillator {
  startsAt = Number.POSITIVE_INFINITY
  disconnected = false
  fired = false
  type = 'sine'
  frequency = { value: 0 }
  connect() {}
  disconnect() {
    this.disconnected = true
  }
  start(when: number) {
    this.startsAt = when
  }
  stop() {}
}

class SimAudioContext {
  currentTime = 0
  sampleRate = 48_000
  state: AudioContextState = 'running'
  destination = {} as AudioDestinationNode
  oscillators: SimOscillator[] = []
  fired: FiredBeep[] = []

  createOscillator() {
    const osc = new SimOscillator()
    this.oscillators.push(osc)
    return osc
  }

  createGain() {
    return {
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: () => undefined,
      disconnect: () => undefined,
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

  /** The audio timeline fires whether or not JS is running, so this is driven by the clock alone. */
  advanceTo(seconds: number, wall: number): void {
    this.currentTime = seconds
    for (const osc of this.oscillators) {
      if (osc.fired || osc.disconnected || osc.startsAt > seconds) continue
      osc.fired = true
      this.fired.push({ startsAt: osc.startsAt, firedAtWall: wall })
    }
  }

  async resume() {
    this.state = 'running'
  }

  async close() {
    this.state = 'closed'
  }
}

/** Wall time the context spends suspended up to `now`. */
function stalledMs(now: number): number {
  return Math.min(Math.max(now - SUSPEND_FROM, 0), SUSPEND_MS)
}

/** The audio clock: wall time less whatever it slept through, at its own rate. */
function audioSeconds(now: number): number {
  return ((now - T0 - stalledMs(now)) * (1 + RATE_ERROR)) / 1000
}

/**
 * Runs a full session. `correcting` selects whether the tick re-anchors the queue, so the same
 * simulation measures both the fix and the behaviour it replaces.
 */
function runSession(correcting: boolean): Map<number, number> {
  const ctx = new SimAudioContext()
  const scheduler = new PingScheduler(ctx as unknown as AudioContext, T0)
  const grid: Grid = { anchorMs: T0, slotMs: SLOT }
  scheduler.rebuild(grid, 0, TOTAL_SLOTS)

  const end = T0 + TOTAL_SLOTS * SLOT
  for (let now = T0; now <= end; now += STEP_MS) {
    ctx.advanceTo(audioSeconds(now), now)

    // A frozen page runs no timers at all, which is the state the whole design assumes.
    const frozen = now > SUSPEND_FROM && now < SUSPEND_FROM + SUSPEND_MS
    const ticked = (now - T0) % TICK_MS === 0
    if (frozen || !ticked) continue

    if (correcting) scheduler.resync(grid, slotIndex(grid, now) + 1, TOTAL_SLOTS, now)
  }

  // The A ping is two beeps; the cue is the first of them, so later beeps of a slot are dropped.
  const onsetBySlot = new Map<number, number>()
  for (const beep of ctx.fired) {
    const slot = Math.round((beep.firedAtWall - T0) / SLOT)
    const known = onsetBySlot.get(slot)
    if (known === undefined || beep.firedAtWall < known) onsetBySlot.set(slot, beep.firedAtWall)
  }
  return onsetBySlot
}

/** Milliseconds between the beep for a slot and the moment the countdown reaches that slot. */
function errorsMs(onsets: Map<number, number>): Map<number, number> {
  return new Map([...onsets].map(([slot, wall]) => [slot, wall - (T0 + slot * SLOT)]))
}

describe('a session measured against its own countdown', () => {
  it('holds every ping within a fifth of a second of the grid', () => {
    const errors = [...errorsMs(runSession(true)).values()].map(Math.abs)
    expect(Math.max(...errors)).toBeLessThan(200)
  })

  it('sounds every slot the session reaches, silencing at most the one being corrected', () => {
    const onsets = runSession(true)
    // Slot 0 is already due when the queue is built, so the session's own start tap covers it.
    const expected = TOTAL_SLOTS - 1
    expect(onsets.size).toBeGreaterThanOrEqual(expected - 1)
    expect(onsets.size).toBeLessThanOrEqual(expected)
  })

  it('never sounds a slot twice', () => {
    const ctxSlots = [...runSession(true).keys()]
    expect(new Set(ctxSlots).size).toBe(ctxSlots.length)
  })

  it('would otherwise accumulate the whole suspension as lag', () => {
    const errors = errorsMs(runSession(false))
    const late = [...errors.values()].filter((e) => e > 2_500)
    // Every ping after the screen lock, not just the first, is late by the stall.
    expect(late.length).toBeGreaterThan(10)
  })

  it('leaves rate error alone until it is worth a correction', () => {
    const uncorrected = errorsMs(runSession(false))
    const corrected = errorsMs(runSession(true))
    const beforeLock = (errors: Map<number, number>) =>
      [...errors].filter(([slot]) => T0 + slot * SLOT < SUSPEND_FROM).map(([, e]) => Math.abs(e))

    // A hardware clock running 200 ppm fast is tens of milliseconds out by the sixth minute:
    // audible drift is not what it produces, and the queue is left alone at that size.
    const worst = Math.max(...beforeLock(uncorrected))
    expect(worst).toBeGreaterThan(20)
    expect(worst).toBeLessThan(120)
    expect(beforeLock(corrected)).toEqual(beforeLock(uncorrected))
  })
})
