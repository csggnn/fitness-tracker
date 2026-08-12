import { db, lastLoadFor } from './db'
import type { Exercise, SetLog } from './types'
import type { SlotPlan } from '../timer/slotPlan'
import { pingTime, type Grid } from '../timer/grid'

/**
 * Slots that have already fired but hold no row yet.
 *
 * The page may be frozen for most of a session, so rows are reconciled from the grid rather than
 * written by a tick. Calling this repeatedly with the same state yields nothing the second time.
 */
export function missingSlotIndexes(existing: Iterable<number>, throughSlot: number): number[] {
  const have = new Set(existing)
  const missing: number[] = []
  for (let i = 0; i <= throughSlot; i++) {
    if (!have.has(i)) missing.push(i)
  }
  return missing
}

export type LoadMap = Record<string, number>

/** Loads to start a session with: the most recent value per exercise, else the seeded default. */
export async function initialLoads(exercises: Exercise[]): Promise<LoadMap> {
  const entries = await Promise.all(
    exercises.map(async (e) => [e.id, await lastLoadFor(e.id, e.defaultLoad)] as const),
  )
  return Object.fromEntries(entries)
}

/**
 * Writes a row for every slot that fired without one, at the target reps and the carried load.
 * Rows the user already edited are never touched.
 */
export async function backfillSets(
  sessionId: number,
  grid: Grid,
  plan: SlotPlan[],
  currentSlot: number,
  loads: LoadMap,
): Promise<number> {
  const throughSlot = Math.min(currentSlot, plan.length - 1)
  if (throughSlot < 0) return 0

  const existing = await db.setLogs.where('sessionId').equals(sessionId).toArray()
  // An informational ping is a cue only and advances no set, so it never produces a row.
  const missing = missingSlotIndexes(
    existing.map((r) => r.slotIndex),
    throughSlot,
  ).filter((i) => !plan[i].informational)
  if (missing.length === 0) return 0

  const rows: SetLog[] = missing.map((slotIndex) => {
    const slot = plan[slotIndex]
    return {
      sessionId,
      exerciseId: slot.exerciseId,
      role: slot.role,
      setIndex: slot.setIndex,
      slotIndex,
      startedAt: pingTime(grid, slotIndex),
      targetReps: slot.targetReps,
      actualReps: slot.targetReps,
      load: loads[slot.exerciseId] ?? 0,
      completed: true,
    }
  })

  // bulkAdd tolerates a concurrent writer having claimed a slot via the unique compound index.
  await db.setLogs.bulkAdd(rows).catch(() => undefined)
  return rows.length
}

export async function updateSetLog(
  sessionId: number,
  slotIndex: number,
  changes: Partial<Pick<SetLog, 'actualReps' | 'load' | 'completed'>>,
): Promise<void> {
  const row = await db.setLogs.where({ sessionId, slotIndex }).first()
  if (!row?.id) return
  await db.setLogs.update(row.id, changes)
}

/** Rounds to the 0.5 kg storage granularity and clamps at zero. */
export function quantizeLoad(kg: number): number {
  return Math.max(0, Math.round(kg * 2) / 2)
}
