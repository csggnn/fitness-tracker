import { pingTime, roleOf, type Grid } from './grid'

/**
 * Holds the entire remaining ping schedule on the Web Audio timeline.
 *
 * A hidden tab has its timers throttled and can be frozen outright, so nothing that reacts to a
 * tick survives a locked screen. Scheduled audio events are sample-accurate and fire whether or
 * not the page is running, which is why every remaining ping is queued up front rather than
 * through a lookahead window.
 *
 * This is the only module that writes to the audio timeline.
 */

/** Minimal surface used from AudioContext, so tests can substitute a recording stub. */
export interface ScheduledNode {
  /** Absent on gain nodes, which are tracked so a rebuild can disconnect them too. */
  stop?(when?: number): void
  disconnect(): void
}

const A_TONE_HZ = 880
const B_TONE_HZ = 440
const BEEP_S = 0.12
const BEEP_GAP_S = 0.1

/**
 * Drift the epoch mapping is allowed to accumulate before the queue is re-anchored.
 *
 * Below this the correction is inaudible and rebuilding costs more than it fixes. Above it the
 * pings are heard late against a countdown that is still right.
 */
const RESYNC_THRESHOLD_MS = 120

/** A ping already sounding is left to finish; cutting it mid-beep is more jarring than its error. */
const IN_FLIGHT_GUARD_S = 0.05

/** One ping and every node it owns. An A ping is two beeps and is cancelled as a unit. */
interface QueuedPing {
  slotIndex: number
  startsAt: number
  endsAt: number
  nodes: ScheduledNode[]
}

export class PingScheduler {
  private ctx: AudioContext
  private queue: QueuedPing[] = []
  private keepAlive?: AudioBufferSourceNode
  /**
   * Epoch time corresponding to ctx.currentTime === 0.
   *
   * The audio clock and the system clock are independent: the audio clock stops advancing while
   * the context is suspended and runs at its own rate otherwise, so this mapping decays over a
   * session and is re-measured by `resync`.
   */
  private epochAtCtxZero: number
  private resyncs = 0

  constructor(ctx: AudioContext, now: number = Date.now()) {
    this.ctx = ctx
    this.epochAtCtxZero = this.measureEpoch(now)
  }

  /** Created inside the start gesture; autoplay policy permits nothing else. */
  static create(now: number = Date.now()): PingScheduler {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    return new PingScheduler(new Ctor(), now)
  }

  get context(): AudioContext {
    return this.ctx
  }

  get scheduledCount(): number {
    return this.queue.reduce((total, ping) => total + ping.nodes.length, 0)
  }

  /** Re-anchorings performed this session. Zero on a session whose clocks never diverged. */
  get resyncCount(): number {
    return this.resyncs
  }

  private measureEpoch(now: number): number {
    return now - this.ctx.currentTime * 1000
  }

  /**
   * How far the queue has slipped, in milliseconds. Positive means the audio clock has fallen
   * behind the system clock and the queued pings are that late.
   */
  driftMs(now: number = Date.now()): number {
    return this.measureEpoch(now) - this.epochAtCtxZero
  }

  private whenFor(grid: Grid, index: number): number {
    return (pingTime(grid, index) - this.epochAtCtxZero) / 1000
  }

  /**
   * Cancels the whole queue and schedules every ping from `fromSlot` to `totalSlots - 1`.
   *
   * Any control that moves `anchorMs` invalidates the existing schedule, so start, resume, jump
   * and slot length change all route through here.
   */
  rebuild(grid: Grid, fromSlot: number, totalSlots: number): void {
    this.cancelAll()
    this.schedule(grid, fromSlot, totalSlots)
  }

  /**
   * Re-anchors the epoch mapping to the system clock and requeues the pings that have not started.
   *
   * The countdown is derived from the system clock, so that clock is what the queue is corrected
   * against: the session keeps the cadence the grid documents and the display stays truthful. A
   * ping whose slot has already been passed is not requeued, so a correction can silence the
   * current ping but can never double it.
   *
   * Returns whether the queue was rebuilt.
   */
  resync(grid: Grid, fromSlot: number, totalSlots: number, now: number = Date.now()): boolean {
    if (grid.pausedAt !== undefined) return false
    if (Math.abs(this.driftMs(now)) < RESYNC_THRESHOLD_MS) return false

    this.epochAtCtxZero = this.measureEpoch(now)
    this.resyncs++
    this.cancelPending()
    this.schedule(grid, fromSlot, totalSlots)
    return true
  }

  private schedule(grid: Grid, fromSlot: number, totalSlots: number): void {
    if (grid.pausedAt !== undefined) return

    const first = Math.max(0, fromSlot)
    for (let i = first; i < totalSlots; i++) {
      const when = this.whenFor(grid, i)
      // Past pings are dropped rather than fired late.
      if (when <= this.ctx.currentTime) continue
      this.schedulePing(i, when, roleOf(i))
    }
  }

  /** A is a double beep, B a single one, so the cue is identifiable without looking. */
  private schedulePing(slotIndex: number, when: number, role: 'A' | 'B'): void {
    const entry: QueuedPing = { slotIndex, startsAt: when, endsAt: when, nodes: [] }
    this.queue.push(entry)
    if (role === 'A') {
      this.scheduleBeep(entry, when, A_TONE_HZ)
      this.scheduleBeep(entry, when + BEEP_S + BEEP_GAP_S, A_TONE_HZ)
    } else {
      this.scheduleBeep(entry, when, B_TONE_HZ, BEEP_S * 1.6)
    }
  }

  private scheduleBeep(entry: QueuedPing, when: number, hz: number, duration: number = BEEP_S): void {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = hz

    // Ramped rather than gated: a bare start/stop on the oscillator clicks at both ends.
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(0.9, when + 0.01)
    gain.gain.setValueAtTime(0.9, when + duration - 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)

    osc.connect(gain)
    gain.connect(this.ctx.destination)
    osc.start(when)
    osc.stop(when + duration + 0.02)

    entry.nodes.push(osc, gain)
    entry.endsAt = Math.max(entry.endsAt, when + duration + 0.02)
  }

  cancelAll(): void {
    for (const ping of this.queue) release(ping)
    this.queue = []
  }

  /** Drops what has not started, keeps what is sounding, and forgets what has finished. */
  private cancelPending(): void {
    const cutoff = this.ctx.currentTime + IN_FLIGHT_GUARD_S
    const sounding: QueuedPing[] = []
    for (const ping of this.queue) {
      if (ping.startsAt > cutoff || ping.endsAt <= this.ctx.currentTime) {
        release(ping)
        continue
      }
      sounding.push(ping)
    }
    this.queue = sounding
  }

  /**
   * Marks the page as playing audio, which is what keeps the context from being suspended in the
   * background. Silent, and connected for the whole session.
   */
  startKeepAlive(): void {
    if (this.keepAlive) return
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(this.ctx.destination)
    source.start()
    this.keepAlive = source
  }

  /** Contexts are suspended on some backgrounding paths; resuming is cheap and idempotent. */
  async resumeContext(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch {
        // Without a gesture this rejects; the next user interaction retries.
      }
    }
  }

  async close(): Promise<void> {
    this.cancelAll()
    try {
      this.keepAlive?.stop()
      this.keepAlive?.disconnect()
    } catch {
      // Already stopped.
    }
    this.keepAlive = undefined
    try {
      await this.ctx.close()
    } catch {
      // Already closed.
    }
  }
}

function release(ping: QueuedPing): void {
  for (const node of ping.nodes) {
    try {
      node.stop?.()
    } catch {
      // Gain nodes have no stop, and an oscillator that already ended throws.
    }
    try {
      node.disconnect()
    } catch {
      // Already disconnected.
    }
  }
}
