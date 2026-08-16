export type Role = 'A' | 'B'

/** `superset` alternates two exercises across slot pairs. `single` occupies one slot pair. */
export type BlockKind = 'superset' | 'single'

export interface Exercise {
  id: string
  name: string
  /** Increment applied by the plus and minus controls. Entry only; storage is always a multiple of 0.5. */
  loadStep: number
  unilateral: boolean
  /** Total kilograms, including bar weight. Used until a set log for this exercise exists. */
  defaultLoad: number
}

export interface Block {
  kind: BlockKind
  exerciseA: string
  exerciseB?: string
  sets: number
  /** Applies to every set of the block. */
  targetRepsA: number
  targetRepsB?: number
  /** Present for holds rather than rep counts. Recorded as reps for storage. */
  holdSeconds?: number
}

export interface WorkoutTemplate {
  id: string
  name: string
  blocks: Block[]
}

export type SessionStatus = 'running' | 'ended'

export interface Session {
  id?: number
  templateId: string
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  status: SessionStatus
  anchorMs: number
  slotMs: number
  pausedAt?: number
  totalPausedMs: number
  startedAt: number
  endedAt?: number
  note?: string
}

export interface SetLog {
  id?: number
  sessionId: number
  exerciseId: string
  role: Role
  setIndex: number
  slotIndex: number
  /** Ping time of the slot, derived from the grid rather than the wall clock at write time. */
  startedAt: number
  targetReps: number
  actualReps: number
  /** Total kilograms as a multiple of 0.5. */
  load: number
  completed: boolean
}
