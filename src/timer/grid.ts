import type { Role } from '../data/types'

/**
 * A free-running metronome on a fixed slot grid.
 *
 * Ping `n` fires at `anchorMs + n * slotMs`. Even `n` is role A, odd `n` is role B, so one
 * superset set spans two slots and the A-to-A cadence is twice the slot length.
 *
 * Position is always derived from a supplied timestamp, never accumulated from previous ticks.
 * Every control is a translation of `anchorMs`, so the grid is never rebuilt and parity can
 * never invert.
 */
export interface Grid {
  anchorMs: number
  slotMs: number
  /** Present only while paused. The effective clock freezes here. */
  pausedAt?: number
}

/** Remainder that stays non-negative for timestamps before the anchor. */
function mod(x: number, m: number): number {
  return ((x % m) + m) % m
}

export function effectiveNow(g: Grid, now: number): number {
  return g.pausedAt ?? now
}

export function elapsedMs(g: Grid, now: number): number {
  return effectiveNow(g, now) - g.anchorMs
}

export function slotIndex(g: Grid, now: number): number {
  return Math.floor(elapsedMs(g, now) / g.slotMs)
}

export function roleOf(index: number): Role {
  return mod(index, 2) === 0 ? 'A' : 'B'
}

/** Always within (0, slotMs]. On a ping boundary this is a full slot, not zero. */
export function msUntilNextPing(g: Grid, now: number): number {
  return g.slotMs - mod(elapsedMs(g, now), g.slotMs)
}

/** Epoch time of ping `n`, unaffected by the paused clock. */
export function pingTime(g: Grid, index: number): number {
  return g.anchorMs + index * g.slotMs
}

export function isPaused(g: Grid): boolean {
  return g.pausedAt !== undefined
}

export function pause(g: Grid, now: number): Grid {
  if (isPaused(g)) return g
  return { ...g, pausedAt: now }
}

/**
 * Shifts every future ping by the paused duration, so the time left in the current slot is
 * exactly what it was at the moment of pausing.
 */
export function resume(g: Grid, now: number): { grid: Grid; pausedMs: number } {
  if (g.pausedAt === undefined) return { grid: g, pausedMs: 0 }
  const pausedMs = now - g.pausedAt
  return {
    grid: { anchorMs: g.anchorMs + pausedMs, slotMs: g.slotMs },
    pausedMs,
  }
}

/** Fires the next ping immediately; the slot after it starts a full `slotMs` from now. */
export function jumpToNext(g: Grid, now: number): Grid {
  return { ...g, anchorMs: g.anchorMs - msUntilNextPing(g, now) }
}

/** Re-anchors to now, so the cursor restarts the current pair at parity 0 (role A). */
export function changeSlotLength(g: Grid, now: number, slotMs: number): Grid {
  return { ...g, anchorMs: effectiveNow(g, now), slotMs }
}
