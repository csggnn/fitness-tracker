import Dexie, { type EntityTable } from 'dexie'
import type { Exercise, Session, SetLog, WorkoutTemplate } from './types'
import { SEED_EXERCISES, SEED_TEMPLATE } from './seed'

class FitnessDb extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>
  templates!: EntityTable<WorkoutTemplate, 'id'>
  sessions!: EntityTable<Session, 'id'>
  setLogs!: EntityTable<SetLog, 'id'>

  constructor() {
    super('fitness-tracker')
    this.version(1).stores({
      exercises: 'id, name',
      templates: 'id, name',
      sessions: '++id, status, date, startedAt',
      // The compound index is what makes slot backfill idempotent.
      setLogs: '++id, sessionId, &[sessionId+slotIndex], [exerciseId+startedAt]',
    })
  }
}

export const db = new FitnessDb()

/** Loads the training plan on first run only. Later edits to the seeded rows are preserved. */
export async function ensureSeeded(): Promise<void> {
  const count = await db.templates.count()
  if (count > 0) return
  await db.transaction('rw', db.exercises, db.templates, async () => {
    await db.exercises.bulkPut(SEED_EXERCISES)
    await db.templates.put(SEED_TEMPLATE)
  })
}

/**
 * Without this the database is evictable under storage pressure, and it holds the only copy of
 * the training history. Installing to the home screen usually grants it outright.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function getRunningSession(): Promise<Session | undefined> {
  return db.sessions.where('status').equals('running').last()
}

/** Most recent load recorded for an exercise, falling back to the seeded default. */
export async function lastLoadFor(exerciseId: string, fallback: number): Promise<number> {
  const last = await db.setLogs
    .where('[exerciseId+startedAt]')
    .between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey])
    .last()
  return last?.load ?? fallback
}
