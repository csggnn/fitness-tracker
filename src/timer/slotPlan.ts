import type { Role, WorkoutTemplate } from '../data/types'

/**
 * One grid slot resolved against a template. Every piece of derived workout state is a lookup
 * into this array by slot index, so nothing is tracked by an incrementing counter that could
 * drift while the page is frozen.
 */
export interface SlotPlan {
  slotIndex: number
  blockIndex: number
  exerciseId: string
  role: Role
  /** 0-based within its block. */
  setIndex: number
  setsInBlock: number
  targetReps: number
  /** Second slot of a `single` block: the ping is a cue only and advances no set. */
  informational: boolean
}

/**
 * Flattens a template into consecutive slots.
 *
 * Every block contributes an even number of slots, so role A stays on even global indices for
 * the whole session regardless of how blocks are ordered.
 */
export function buildSlotPlan(template: WorkoutTemplate): SlotPlan[] {
  const slots: SlotPlan[] = []

  template.blocks.forEach((block, blockIndex) => {
    if (block.kind === 'superset') {
      for (let setIndex = 0; setIndex < block.sets; setIndex++) {
        slots.push({
          slotIndex: slots.length,
          blockIndex,
          exerciseId: block.exerciseA,
          role: 'A',
          setIndex,
          setsInBlock: block.sets,
          targetReps: repsAt(block.targetRepsA, setIndex),
          informational: false,
        })
        slots.push({
          slotIndex: slots.length,
          blockIndex,
          exerciseId: block.exerciseB ?? block.exerciseA,
          role: 'B',
          setIndex,
          setsInBlock: block.sets,
          targetReps: repsAt(block.targetRepsB ?? block.targetRepsA, setIndex),
          informational: false,
        })
      }
      return
    }

    // A `single` block occupies one slot pair per set. The second ping of each pair is a cue.
    for (let setIndex = 0; setIndex < block.sets; setIndex++) {
      const reps = block.holdSeconds ?? repsAt(block.targetRepsA, setIndex)
      slots.push({
        slotIndex: slots.length,
        blockIndex,
        exerciseId: block.exerciseA,
        role: 'A',
        setIndex,
        setsInBlock: block.sets,
        targetReps: reps,
        informational: false,
      })
      slots.push({
        slotIndex: slots.length,
        blockIndex,
        exerciseId: block.exerciseA,
        role: 'B',
        setIndex,
        setsInBlock: block.sets,
        targetReps: reps,
        informational: true,
      })
    }
  })

  return slots
}

/** Rep schemes shorter than the set count repeat their last entry. */
function repsAt(reps: number[], setIndex: number): number {
  if (reps.length === 0) return 0
  return reps[Math.min(setIndex, reps.length - 1)]
}
