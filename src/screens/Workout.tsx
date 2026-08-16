import { useMemo, useState } from 'react'
import { roleOf } from '../timer/grid'
import { useWakeLock } from '../timer/useWakeLock'
import type { SessionApi } from '../timer/useSession'
import type { SlotPlan } from '../timer/slotPlan'
import type { SetLog } from '../data/types'
import { formatClock, formatLoad, formatSets, formatTarget } from '../format'

const FAST = new URLSearchParams(window.location.search).has('fast')
/** `?debug` surfaces the audio-versus-system clock slip, which is otherwise only audible. */
const DEBUG = new URLSearchParams(window.location.search).has('debug')
const SLOT_CHOICES = FAST ? [5_000, 10_000, 75_000] : [70_000, 75_000, 82_000, 90_000]

export default function Workout(api: SessionApi) {
  const {
    plan,
    exercises,
    logs,
    loads,
    currentSlot,
    msToNextPing,
    paused,
    finished,
    needsAudioResume,
    session,
    togglePause,
    jump,
    setSlotMs,
    end,
    editSet,
    resumeAudio,
    audioStatus,
  } = api

  const [showSlotPicker, setShowSlotPicker] = useState(false)
  useWakeLock(Boolean(session) && !finished)

  const slot = plan[currentSlot]
  const logBySlot = useMemo(() => new Map(logs.map((l) => [l.slotIndex, l])), [logs])
  const activeLog = logBySlot.get(currentSlot)
  const nextRole = roleOf(currentSlot + 1)

  const blockSlots = useMemo(
    () => plan.filter((s) => s.blockIndex === slot?.blockIndex),
    [plan, slot?.blockIndex],
  )
  const slotA = blockSlots.find((s) => s.role === 'A')
  const slotB = blockSlots.find((s) => s.role === 'B')
  const isSingle = slotA?.exerciseId === slotB?.exerciseId
  const nextId = nextSlotExercise(plan, currentSlot)

  if (finished) {
    return (
      <main className="screen finished">
        <h1>Session complete</h1>
        <p className="meta">{logs.length} sets recorded</p>
        <ul className="summary-list">
          {[...groupByExercise(logs)].map(([id, rows]) => (
            <li key={id}>
              <span className="name">{exercises[id]?.name ?? id}</span>
              <span className="detail">{formatSets(rows.map((r) => r.actualReps), rows[0].load)}</span>
            </li>
          ))}
        </ul>
        <button className="start" onClick={() => void end()}>
          Save and finish
        </button>
      </main>
    )
  }

  return (
    <main className={paused ? 'screen workout paused' : 'screen workout'}>
      {needsAudioResume && (
        <button className="audio-banner" onClick={resumeAudio}>
          Session restored — tap to re-arm the pings
        </button>
      )}

      {/* Not a tap target: an accidental brush must not hold the cadence. */}
      <section className="countdown">
        <div className="time">{formatClock(msToNextPing)}</div>
        <div className="upcoming">
          {paused ? 'PAUSED' : `next: ${nextRole} · ${exercises[nextId]?.name ?? '—'}${nextLoad(loads[nextId])}`}
        </div>
      </section>

      <section className="pair">
        {isSingle ? (
          <ExerciseCard
            title={exercises[slotA!.exerciseId]?.name ?? slotA!.exerciseId}
            role="A"
            active
            detail={formatTarget(`${slot.targetReps}s`, 'hold', loads[slotA!.exerciseId] ?? 0)}
          />
        ) : (
          <>
            <ExerciseCard
              title={exercises[slotA!.exerciseId]?.name ?? slotA!.exerciseId}
              role="A"
              active={slot.role === 'A'}
              detail={formatTarget(`${slotA!.targetReps}`, 'reps', loads[slotA!.exerciseId] ?? 0)}
            />
            <ExerciseCard
              title={exercises[slotB!.exerciseId]?.name ?? slotB!.exerciseId}
              role="B"
              active={slot.role === 'B'}
              detail={formatTarget(`${slotB!.targetReps}`, 'reps', loads[slotB!.exerciseId] ?? 0)}
            />
          </>
        )}
      </section>

      <section className="set-meta">
        Set {slot.setIndex + 1} of {slot.setsInBlock} · slot {currentSlot + 1}/{plan.length}
        {DEBUG && <AudioDebug status={audioStatus()} />}
      </section>

      <SetEditor
        slot={slot}
        log={activeLog}
        loadStep={exercises[slot.exerciseId]?.loadStep ?? 2.5}
        onChange={(changes) => void editSet(currentSlot, changes)}
      />

      <section className="controls">
        <button className={paused ? 'control primary resume' : 'control primary'} onClick={() => void togglePause()}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="control primary" onClick={() => void jump()}>
          Jump to next
        </button>
      </section>

      <section className="controls secondary">
        <button className="control" onClick={() => setShowSlotPicker((v) => !v)}>
          Slot {formatClock(session?.slotMs ?? 0)}
        </button>
        <button className="control danger" onClick={() => void end()}>
          End
        </button>
      </section>

      {showSlotPicker && (
        <section className="choices">
          {SLOT_CHOICES.map((ms) => (
            <button
              key={ms}
              className={ms === session?.slotMs ? 'choice active' : 'choice'}
              onClick={() => {
                void setSlotMs(ms)
                setShowSlotPicker(false)
              }}
            >
              {formatClock(ms)}
            </button>
          ))}
          <p className="hint">Changing the slot re-anchors to now and restarts the pair on A.</p>
        </section>
      )}
    </main>
  )
}

function ExerciseCard({
  title,
  role,
  active,
  detail,
}: {
  title: string
  role: 'A' | 'B'
  active: boolean
  detail: string
}) {
  return (
    <div className={active ? 'card active' : 'card'}>
      <span className="role">{role}</span>
      <span className="title">{title}</span>
      <span className="detail">{detail}</span>
    </div>
  )
}

/** Prefilled from the auto-logged row; touched only when the set differed from the target. */
function SetEditor({
  slot,
  log,
  loadStep,
  onChange,
}: {
  slot: SlotPlan
  log?: SetLog
  loadStep: number
  onChange: (changes: { actualReps?: number; load?: number }) => void
}) {
  const reps = log?.actualReps ?? slot.targetReps
  const load = log?.load ?? 0
  const disabled = !log

  return (
    <section className="set-editor">
      <div className="stepper">
        <button disabled={disabled} onClick={() => onChange({ actualReps: Math.max(0, reps - 1) })}>
          −
        </button>
        <div className="value">
          <strong>{reps}</strong>
          <small>{slot.targetReps === reps ? 'reps' : `reps (target ${slot.targetReps})`}</small>
        </div>
        <button disabled={disabled} onClick={() => onChange({ actualReps: reps + 1 })}>
          +
        </button>
      </div>

      <div className="stepper">
        <button disabled={disabled} onClick={() => onChange({ load: load - loadStep })}>
          −
        </button>
        <div className="value">
          <strong>{formatLoad(load)}</strong>
          <small>kg · step {formatLoad(loadStep)}</small>
        </div>
        <button disabled={disabled} onClick={() => onChange({ load: load + loadStep })}>
          +
        </button>
      </div>
    </section>
  )
}

/** Slip of the audio queue against the system clock, and how often it has been corrected. */
function AudioDebug({ status }: { status: { driftMs: number; resyncs: number } }) {
  return (
    <>
      <br />
      audio {Math.round(status.driftMs)} ms · {status.resyncs} resyncs
    </>
  )
}

/** Load clause of the next-up line. Empty for bodyweight work. */
function nextLoad(load: number | undefined): string {
  return load && load > 0 ? ` · ${formatLoad(load)} kg` : ''
}

function nextSlotExercise(plan: SlotPlan[], currentSlot: number): string {
  return plan[currentSlot + 1]?.exerciseId ?? plan[currentSlot]?.exerciseId ?? ''
}

function groupByExercise(logs: SetLog[]): Map<string, SetLog[]> {
  const map = new Map<string, SetLog[]>()
  for (const log of logs) {
    const rows = map.get(log.exerciseId) ?? []
    rows.push(log)
    map.set(log.exerciseId, rows)
  }
  return map
}
