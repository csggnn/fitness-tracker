import { useEffect, useState } from 'react'
import { db } from '../data/db'
import { DEFAULT_SLOT_MS, WARMUP_NOTE } from '../data/seed'
import type { Session, SetLog } from '../data/types'
import type { SessionApi } from '../timer/useSession'
import { formatClock, formatSets } from '../format'

/** Slot lengths down to 5s, so a full 26-slot session can be watched end to end during testing. */
const FAST = new URLSearchParams(window.location.search).has('fast')
const SLOT_CHOICES = FAST ? [5_000, 10_000, 75_000] : [70_000, 75_000, 82_000, 90_000]

export default function Today({ start, exercises }: SessionApi) {
  const [last, setLast] = useState<{ session: Session; logs: SetLog[] } | null>(null)
  const [slotMs, setSlotMs] = useState(DEFAULT_SLOT_MS)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void (async () => {
      const session = await db.sessions.where('status').equals('ended').last()
      if (!session?.id) return
      setLast({ session, logs: await db.setLogs.where('sessionId').equals(session.id).toArray() })
    })()
  }, [])

  const onStart = async () => {
    setStarting(true)
    try {
      await start(slotMs)
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className="screen today">
      <header>
        <h1>Arm superset split</h1>
        <p className="warmup">Warm-up before you start: {WARMUP_NOTE}</p>
      </header>

      <section className="slot-picker">
        <h2>Slot length</h2>
        <div className="choices">
          {SLOT_CHOICES.map((ms) => (
            <button
              key={ms}
              className={ms === slotMs ? 'choice active' : 'choice'}
              onClick={() => setSlotMs(ms)}
            >
              {formatClock(ms)}
            </button>
          ))}
        </div>
        <p className="hint">A-to-A cadence is {formatClock(slotMs * 2)}. Adjustable mid-session.</p>
      </section>

      {/* Constructing the AudioContext requires this tap; nothing else can arm the schedule. */}
      <button className="start" onClick={onStart} disabled={starting}>
        Start workout
      </button>

      <section className="last-session">
        <h2>Last session</h2>
        {last ? (
          <LastSessionSummary session={last.session} logs={last.logs} exercises={exercises} />
        ) : (
          <p className="hint">No sessions recorded yet.</p>
        )}
      </section>
    </main>
  )
}

function LastSessionSummary({
  session,
  logs,
  exercises,
}: {
  session: Session
  logs: SetLog[]
  exercises: SessionApi['exercises']
}) {
  const working = (session.endedAt ?? session.startedAt) - session.startedAt - session.totalPausedMs
  const byExercise = new Map<string, SetLog[]>()
  for (const log of logs) {
    const rows = byExercise.get(log.exerciseId) ?? []
    rows.push(log)
    byExercise.set(log.exerciseId, rows)
  }

  return (
    <>
      <p className="meta">
        {session.date} · {logs.length} sets · {formatClock(working)} working
      </p>
      <ul className="summary-list">
        {[...byExercise].map(([id, rows]) => (
          <li key={id}>
            <span className="name">{exercises[id]?.name ?? id}</span>
            <span className="detail">{formatSets(rows.map((r) => r.actualReps), rows[0].load)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
