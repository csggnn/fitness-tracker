import { describe, expect, it } from 'vitest'
import { buildSlotPlan } from './slotPlan'
import { roleOf } from './grid'
import { SEED_TEMPLATE } from '../data/seed'

describe('slot plan from the seeded training plan', () => {
  const plan = buildSlotPlan(SEED_TEMPLATE)

  it('spans four supersets and the finisher', () => {
    // 4 supersets x 3 sets x 2 slots, plus one slot pair for the plank.
    expect(plan).toHaveLength(26)
  })

  it('agrees with the grid on which role each slot carries', () => {
    for (const slot of plan) {
      expect(slot.role).toBe(roleOf(slot.slotIndex))
    }
  })

  it('places the A-starts on the cadence the training plan documents', () => {
    const slotMs = 75_000
    const aStarts = plan.filter((s) => s.role === 'A').map((s) => (s.slotIndex * slotMs) / 1000)
    expect(aStarts.slice(0, 3)).toEqual([0, 150, 300])
    // Superset 2 opens at 7:30 with no gap between blocks.
    expect(aStarts[3]).toBe(450)
  })

  it('repeats one rep target across the sets of a block', () => {
    const biceps = plan.filter((s) => s.exerciseId === 'biceps-machine')
    expect(biceps.map((s) => s.targetReps)).toEqual([10, 10, 10])
  })

  it('gives the finisher a slot pair whose second ping advances nothing', () => {
    const plank = plan.filter((s) => s.exerciseId === 'plank')
    expect(plank).toHaveLength(2)
    expect(plank[0].informational).toBe(false)
    expect(plank[1].informational).toBe(true)
    expect(plank[0].targetReps).toBe(140)
  })

  it('numbers sets within each block', () => {
    const press = plan.filter((s) => s.exerciseId === 'incline-press')
    expect(press.map((s) => s.setIndex)).toEqual([0, 1, 2])
    expect(press.every((s) => s.setsInBlock === 3)).toBe(true)
  })
})
