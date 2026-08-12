import type { Exercise, WorkoutTemplate } from './types'

/**
 * The training plan from docs/plans/training-plan.md, loads included.
 *
 * Loads are totals in kilograms. The incline press folds in an assumed 10 kg bar; only the change
 * over time is tracked, so an inaccurate bar weight shifts every value by a constant.
 */
export const SEED_EXERCISES: Exercise[] = [
  { id: 'incline-press', name: 'Incline press', loadStep: 2.5, unilateral: false, defaultLoad: 50 },
  { id: 'biceps-machine', name: 'Biceps machine', loadStep: 2.5, unilateral: false, defaultLoad: 32.5 },
  { id: 'db-row', name: 'One-arm dumbbell row', loadStep: 2, unilateral: true, defaultLoad: 26 },
  { id: 'triceps-extension', name: 'Overhead triceps extension', loadStep: 2, unilateral: false, defaultLoad: 16 },
  { id: 'shoulder-press', name: 'Shoulder press', loadStep: 2.5, unilateral: false, defaultLoad: 25 },
  { id: 'db-curl', name: 'Dumbbell biceps curl', loadStep: 2, unilateral: true, defaultLoad: 14 },
  { id: 'dip-machine', name: 'Triceps dip machine', loadStep: 2.5, unilateral: false, defaultLoad: 60 },
  { id: 'abs', name: 'Abs', loadStep: 2.5, unilateral: false, defaultLoad: 50 },
  { id: 'plank', name: 'Mixed plank', loadStep: 2.5, unilateral: false, defaultLoad: 0 },
]

export const SEED_TEMPLATE: WorkoutTemplate = {
  id: 'arm-superset-split',
  name: 'Arm-focused superset split',
  blocks: [
    {
      kind: 'superset',
      exerciseA: 'incline-press',
      exerciseB: 'biceps-machine',
      sets: 3,
      targetRepsA: [10, 10, 10],
      targetRepsB: [12, 10, 8],
    },
    {
      kind: 'superset',
      exerciseA: 'db-row',
      exerciseB: 'triceps-extension',
      sets: 3,
      targetRepsA: [10, 10, 10],
      targetRepsB: [10, 10, 10],
    },
    {
      kind: 'superset',
      exerciseA: 'shoulder-press',
      exerciseB: 'db-curl',
      sets: 3,
      targetRepsA: [10, 10, 10],
      targetRepsB: [10, 10, 10],
    },
    {
      kind: 'superset',
      exerciseA: 'dip-machine',
      exerciseB: 'abs',
      sets: 3,
      targetRepsA: [10, 10, 10],
      targetRepsB: [20, 20, 20],
    },
    {
      kind: 'single',
      exerciseA: 'plank',
      sets: 1,
      targetRepsA: [0],
      holdSeconds: 140,
    },
  ],
}

/** The rower warm-up is not on the grid: it precedes the first work set, which is the anchor. */
export const WARMUP_NOTE = 'Rower, 60 kcal'

export const DEFAULT_SLOT_MS = 75_000
