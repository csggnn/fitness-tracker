/** m:ss, rounding up so a countdown reads 1:15 for the whole first second. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Trailing zeros dropped: 32.5 kg stays 32.5, 26.0 kg reads 26. */
export function formatLoad(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1)
}

/**
 * Target for one set: "10 × 50 kg" when loaded, "10 reps" or "45s hold" when not.
 * Loaded work drops the unit label so the quantity and the load stay on one line.
 */
export function formatTarget(quantity: string, unit: string, load: number): string {
  return load > 0 ? `${quantity} × ${formatLoad(load)} kg` : `${quantity} ${unit}`
}

/** Reps across the sets of one exercise. Bodyweight work carries no load clause. */
export function formatSets(reps: number[], load: number): string {
  const joined = reps.join(' / ')
  return load > 0 ? `${joined} @ ${formatLoad(load)} kg` : joined
}
