import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, ensureSeeded, getRunningSession, requestPersistence } from '../data/db'
import { DEFAULT_SLOT_MS, SEED_TEMPLATE } from '../data/seed'
import { backfillSets, initialLoads, quantizeLoad, updateSetLog, type LoadMap } from '../data/logging'
import type { Exercise, Session, SetLog, WorkoutTemplate } from '../data/types'
import { buildSlotPlan, type SlotPlan } from './slotPlan'
import { PingScheduler } from './audio'
import {
  changeSlotLength,
  isPaused,
  jumpToNext,
  msUntilNextPing,
  pause,
  resume,
  slotIndex,
  type Grid,
} from './grid'

const TICK_MS = 200

export interface SessionView {
  ready: boolean
  session: Session | null
  grid: Grid | null
  plan: SlotPlan[]
  exercises: Record<string, Exercise>
  logs: SetLog[]
  loads: LoadMap
  now: number
  /** Clamped to the last slot once the plan is exhausted. */
  currentSlot: number
  msToNextPing: number
  paused: boolean
  finished: boolean
  /** A restored session cannot schedule audio until the next user gesture. */
  needsAudioResume: boolean
}

export type SessionApi = ReturnType<typeof useSession>

export function useSession() {
  const [template] = useState<WorkoutTemplate>(SEED_TEMPLATE)
  const [exercises, setExercises] = useState<Record<string, Exercise>>({})
  const [session, setSession] = useState<Session | null>(null)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [loads, setLoads] = useState<LoadMap>({})
  const [logs, setLogs] = useState<SetLog[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [ready, setReady] = useState(false)
  const [needsAudioResume, setNeedsAudioResume] = useState(false)

  const scheduler = useRef<PingScheduler | null>(null)
  const plan = useMemo(() => buildSlotPlan(template), [template])

  // Load the seed and any session left running by a previous page load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureSeeded()
      const [all, running] = await Promise.all([db.exercises.toArray(), getRunningSession()])
      if (cancelled) return
      const byId = Object.fromEntries(all.map((e) => [e.id, e]))
      setExercises(byId)
      setLoads(await initialLoads(all))
      if (running?.id) {
        setSession(running)
        setGrid({ anchorMs: running.anchorMs, slotMs: running.slotMs, pausedAt: running.pausedAt })
        setLogs(await db.setLogs.where('sessionId').equals(running.id).sortBy('slotIndex'))
        setNeedsAudioResume(true)
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session || session.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [session])

  const currentSlot = grid ? slotIndex(grid, now) : -1
  const finished = currentSlot >= plan.length
  const clampedSlot = Math.min(Math.max(currentSlot, 0), plan.length - 1)
  const paused = grid ? isPaused(grid) : false

  const refreshLogs = useCallback(async (sessionId: number) => {
    setLogs(await db.setLogs.where('sessionId').equals(sessionId).sortBy('slotIndex'))
  }, [])

  const persistGrid = useCallback(async (sessionId: number, next: Grid, extra?: Partial<Session>) => {
    await db.sessions.update(sessionId, {
      anchorMs: next.anchorMs,
      slotMs: next.slotMs,
      pausedAt: next.pausedAt,
      ...extra,
    })
  }, [])

  // Reconcile rows for every slot that has fired. Runs on tick and after any control, so a
  // session that ran entirely with the screen off materialises when the phone is picked up.
  useEffect(() => {
    if (!session?.id || !grid || session.status !== 'running' || currentSlot < 0) return
    let cancelled = false
    void (async () => {
      const written = await backfillSets(session.id!, grid, plan, currentSlot, loads)
      if (written > 0 && !cancelled) await refreshLogs(session.id!)
    })()
    return () => {
      cancelled = true
    }
  }, [session, grid, plan, clampedSlot, finished, loads, refreshLogs, currentSlot])

  // The queue is pinned to a mapping between the audio clock and the system clock, and that
  // mapping decays: the audio clock stops advancing while the context is suspended, which a locked
  // screen does routinely. Left alone the pings run late against a countdown that is still right,
  // so the mapping is re-measured every tick and the queue re-anchored once it has slipped.
  useEffect(() => {
    if (!session?.id || !grid || session.status !== 'running' || isPaused(grid)) return
    scheduler.current?.resync(grid, slotIndex(grid, now) + 1, plan.length, now)
  }, [grid, now, plan.length, session])

  const rebuildAudio = useCallback(
    (next: Grid, fromSlot: number) => {
      scheduler.current?.rebuild(next, fromSlot, plan.length)
    },
    [plan.length],
  )

  const start = useCallback(
    async (slotMs: number = DEFAULT_SLOT_MS) => {
      const anchorMs = Date.now()
      const next: Grid = { anchorMs, slotMs }
      void requestPersistence()

      const id = (await db.sessions.add({
        templateId: template.id,
        date: localDate(anchorMs),
        status: 'running',
        anchorMs,
        slotMs,
        totalPausedMs: 0,
        startedAt: anchorMs,
      } as Session)) as number

      // Constructed inside the tap: autoplay policy permits nothing else.
      scheduler.current = PingScheduler.create(anchorMs)
      scheduler.current.startKeepAlive()
      scheduler.current.rebuild(next, 0, plan.length)

      setGrid(next)
      setSession((await db.sessions.get(id)) ?? null)
      setLogs([])
      setNeedsAudioResume(false)
      setNow(Date.now())
    },
    [plan.length, template.id],
  )

  /** Re-arms audio for a session restored by a page reload. Must run inside a gesture. */
  const resumeAudio = useCallback(() => {
    if (!grid) return
    scheduler.current?.close()
    scheduler.current = PingScheduler.create()
    scheduler.current.startKeepAlive()
    scheduler.current.rebuild(grid, slotIndex(grid, Date.now()) + 1, plan.length)
    setNeedsAudioResume(false)
  }, [grid, plan.length])

  const togglePause = useCallback(async () => {
    if (!session?.id || !grid) return
    if (isPaused(grid)) {
      const { grid: next, pausedMs } = resume(grid, Date.now())
      setGrid(next)
      await persistGrid(session.id, next, { totalPausedMs: session.totalPausedMs + pausedMs })
      setSession({ ...session, ...next, pausedAt: undefined, totalPausedMs: session.totalPausedMs + pausedMs })
      rebuildAudio(next, slotIndex(next, Date.now()) + 1)
    } else {
      const next = pause(grid, Date.now())
      setGrid(next)
      await persistGrid(session.id, next)
      setSession({ ...session, pausedAt: next.pausedAt })
      // Pause drops the queue outright; resume is what rebuilds it.
      scheduler.current?.cancelAll()
    }
  }, [grid, persistGrid, rebuildAudio, session])

  const jump = useCallback(async () => {
    if (!session?.id || !grid) return
    const next = jumpToNext(grid, Date.now())
    setGrid(next)
    await persistGrid(session.id, next)
    setSession({ ...session, anchorMs: next.anchorMs })
    rebuildAudio(next, slotIndex(next, Date.now()) + 1)
    setNow(Date.now())
  }, [grid, persistGrid, rebuildAudio, session])

  const setSlotMs = useCallback(
    async (slotMs: number) => {
      if (!session?.id || !grid) return
      const next = changeSlotLength(grid, Date.now(), slotMs)
      setGrid(next)
      await persistGrid(session.id, next)
      setSession({ ...session, anchorMs: next.anchorMs, slotMs })
      rebuildAudio(next, 0)
      setNow(Date.now())
    },
    [grid, persistGrid, rebuildAudio, session],
  )

  const end = useCallback(async () => {
    if (!session?.id) return
    await db.sessions.update(session.id, { status: 'ended', endedAt: Date.now() })
    await scheduler.current?.close()
    scheduler.current = null
    setSession(null)
    setGrid(null)
    setLogs([])
    setNeedsAudioResume(false)
  }, [session])

  const editSet = useCallback(
    async (slotIdx: number, changes: { actualReps?: number; load?: number }) => {
      if (!session?.id) return
      const patch = { ...changes }
      if (patch.load !== undefined) {
        patch.load = quantizeLoad(patch.load)
        const exerciseId = plan[slotIdx]?.exerciseId
        // Later sets of the same exercise inherit the change; earlier rows keep what was used.
        if (exerciseId) setLoads((prev) => ({ ...prev, [exerciseId]: patch.load! }))
      }
      await updateSetLog(session.id, slotIdx, patch)
      await refreshLogs(session.id)
    },
    [plan, refreshLogs, session],
  )

  /** Slip between the audio queue and the system clock, for the on-screen debug readout. */
  const audioStatus = useCallback(
    () => ({
      driftMs: scheduler.current?.driftMs() ?? 0,
      resyncs: scheduler.current?.resyncCount ?? 0,
    }),
    [],
  )

  // Contexts get suspended on some backgrounding paths; reclaim on the way back in. The tick that
  // setNow forces is what re-anchors the queue against however long the context was stalled.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void scheduler.current?.resumeContext()
        setNow(Date.now())
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const view: SessionView = {
    ready,
    session,
    grid,
    plan,
    exercises,
    logs,
    loads,
    now,
    currentSlot: clampedSlot,
    msToNextPing: grid ? msUntilNextPing(grid, now) : 0,
    paused,
    finished,
    needsAudioResume,
  }

  return { ...view, start, togglePause, jump, setSlotMs, end, editSet, resumeAudio, audioStatus }
}

function localDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
