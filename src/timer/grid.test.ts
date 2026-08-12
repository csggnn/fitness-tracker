import { describe, expect, it } from 'vitest'
import {
  changeSlotLength,
  jumpToNext,
  msUntilNextPing,
  pause,
  pingTime,
  resume,
  roleOf,
  slotIndex,
  type Grid,
} from './grid'

const T0 = 1_700_000_000_000
const SLOT = 75_000
const base = (): Grid => ({ anchorMs: T0, slotMs: SLOT })

describe('position on the grid', () => {
  it('advances one slot per slot length', () => {
    const g = base()
    expect(slotIndex(g, T0)).toBe(0)
    expect(slotIndex(g, T0 + SLOT - 1)).toBe(0)
    expect(slotIndex(g, T0 + SLOT)).toBe(1)
    expect(slotIndex(g, T0 + 25 * SLOT)).toBe(25)
  })

  it('puts A on even slots and B on odd ones', () => {
    expect(roleOf(0)).toBe('A')
    expect(roleOf(1)).toBe('B')
    expect(roleOf(24)).toBe('A')
    expect(roleOf(25)).toBe('B')
  })

  it('keeps the countdown within one slot, including on a ping boundary', () => {
    const g = base()
    expect(msUntilNextPing(g, T0)).toBe(SLOT)
    expect(msUntilNextPing(g, T0 + 1)).toBe(SLOT - 1)
    expect(msUntilNextPing(g, T0 + SLOT)).toBe(SLOT)
    for (const offset of [-SLOT * 1.5, -1, 0, 1, SLOT * 9.7]) {
      const remaining = msUntilNextPing(g, T0 + offset)
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(SLOT)
    }
  })

  it('recomputes position after a gap larger than one pair rather than accumulating', () => {
    const g = base()
    const afterFreeze = T0 + 11 * SLOT + 3_000
    expect(slotIndex(g, afterFreeze)).toBe(11)
    expect(roleOf(slotIndex(g, afterFreeze))).toBe('B')
    expect(msUntilNextPing(g, afterFreeze)).toBe(SLOT - 3_000)
  })

  it('reports ping times independent of the paused clock', () => {
    const g = pause(base(), T0 + 1_000)
    expect(pingTime(g, 4)).toBe(T0 + 4 * SLOT)
  })
})

describe('controls', () => {
  it('holds the remaining time while paused', () => {
    const g = pause(base(), T0 + 20_000)
    expect(msUntilNextPing(g, T0 + 20_000)).toBe(SLOT - 20_000)
    expect(msUntilNextPing(g, T0 + 600_000)).toBe(SLOT - 20_000)
    expect(slotIndex(g, T0 + 600_000)).toBe(0)
  })

  it('preserves the remaining time across pause and resume for any pause duration', () => {
    for (const at of [1, 12_345, SLOT - 1, SLOT * 3 + 500]) {
      for (const held of [50, 5_000, 8 * 60 * 60 * 1000]) {
        const before = msUntilNextPing(base(), T0 + at)
        const paused = pause(base(), T0 + at)
        const { grid: resumed, pausedMs } = resume(paused, T0 + at + held)
        expect(pausedMs).toBe(held)
        expect(msUntilNextPing(resumed, T0 + at + held)).toBe(before)
      }
    }
  })

  it('keeps the same slot and role across pause and resume', () => {
    const at = T0 + SLOT * 5 + 900
    const paused = pause(base(), at)
    const { grid: resumed } = resume(paused, at + 400_000)
    expect(slotIndex(resumed, at + 400_000)).toBe(5)
    expect(roleOf(slotIndex(resumed, at + 400_000))).toBe('B')
  })

  it('advances exactly one slot on jump, with a full slot after it', () => {
    const at = T0 + 10_000
    const jumped = jumpToNext(base(), at)
    expect(slotIndex(jumped, at)).toBe(1)
    expect(msUntilNextPing(jumped, at)).toBe(SLOT)
    expect(slotIndex(jumped, at + SLOT)).toBe(2)
  })

  it('re-anchors to parity 0 on a slot length change', () => {
    const at = T0 + SLOT * 3 + 40_000
    const next = changeSlotLength(base(), at, 82_000)
    expect(next.slotMs).toBe(82_000)
    expect(slotIndex(next, at)).toBe(0)
    expect(roleOf(slotIndex(next, at))).toBe('A')
    expect(msUntilNextPing(next, at)).toBe(82_000)
  })

  it('holds parity through an arbitrary sequence of controls', () => {
    let g = base()
    let t = T0
    let expectedSlot = 0

    const advance = (ms: number) => {
      t += ms
      expectedSlot = slotIndex(g, t)
    }

    advance(30_000)
    g = jumpToNext(g, t)
    expectedSlot = slotIndex(g, t)
    expect(expectedSlot).toBe(1)

    g = pause(g, t)
    t += 90_000
    const { grid: afterResume } = resume(g, t)
    g = afterResume
    expect(slotIndex(g, t)).toBe(expectedSlot)

    advance(SLOT * 2)
    expect(slotIndex(g, t)).toBe(3)
    expect(roleOf(slotIndex(g, t))).toBe('B')

    g = jumpToNext(g, t)
    expect(slotIndex(g, t)).toBe(4)
    expect(roleOf(slotIndex(g, t))).toBe('A')
  })
})
