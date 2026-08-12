import { describe, expect, it } from 'vitest'
import { missingSlotIndexes, quantizeLoad } from './logging'
import { buildSlotPlan } from '../timer/slotPlan'
import { SEED_TEMPLATE } from './seed'

describe('slot backfill', () => {
  it('claims every slot that fired while nothing was running', () => {
    expect(missingSlotIndexes([], 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('is idempotent once the rows exist', () => {
    const written = missingSlotIndexes([], 8)
    expect(missingSlotIndexes(written, 8)).toEqual([])
  })

  it('fills only the gaps left by a partial write', () => {
    expect(missingSlotIndexes([0, 1, 4], 5)).toEqual([2, 3, 5])
  })

  it('writes nothing before the first ping', () => {
    expect(missingSlotIndexes([], -1)).toEqual([])
  })

  it('records no row for the finisher cue ping', () => {
    const plan = buildSlotPlan(SEED_TEMPLATE)
    const rows = missingSlotIndexes([], plan.length - 1).filter((i) => !plan[i].informational)
    // 26 slots, but the plank's second ping only marks the end of the hold.
    expect(rows).toHaveLength(25)
    expect(rows).not.toContain(25)
  })
})

describe('load granularity', () => {
  it('stores multiples of 0.5 kg', () => {
    expect(quantizeLoad(32.5)).toBe(32.5)
    expect(quantizeLoad(32.4)).toBe(32.5)
    expect(quantizeLoad(32.24)).toBe(32)
    expect(quantizeLoad(50 + 2.5)).toBe(52.5)
    expect(quantizeLoad(26 + 2)).toBe(28)
  })

  it('never goes negative', () => {
    expect(quantizeLoad(-5)).toBe(0)
  })
})
