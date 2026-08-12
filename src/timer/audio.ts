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

export class PingScheduler {
  private ctx: AudioContext
  private nodes: ScheduledNode[] = []
  private keepAlive?: AudioBufferSourceNode
  /** Epoch time corresponding to ctx.currentTime === 0, captured once. */
  private epochAtCtxZero: number

  constructor(ctx: AudioContext, now: number = Date.now()) {
    this.ctx = ctx
    this.epochAtCtxZero = now - ctx.currentTime * 1000
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
    return this.nodes.length
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
    if (grid.pausedAt !== undefined) return

    const first = Math.max(0, fromSlot)
    for (let i = first; i < totalSlots; i++) {
      const when = this.whenFor(grid, i)
      // Past pings are dropped rather than fired late.
      if (when <= this.ctx.currentTime) continue
      this.schedulePing(when, roleOf(i))
    }
  }

  /** A is a double beep, B a single one, so the cue is identifiable without looking. */
  private schedulePing(when: number, role: 'A' | 'B'): void {
    if (role === 'A') {
      this.scheduleBeep(when, A_TONE_HZ)
      this.scheduleBeep(when + BEEP_S + BEEP_GAP_S, A_TONE_HZ)
    } else {
      this.scheduleBeep(when, B_TONE_HZ, BEEP_S * 1.6)
    }
  }

  private scheduleBeep(when: number, hz: number, duration: number = BEEP_S): void {
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

    this.nodes.push(osc, gain)
  }

  cancelAll(): void {
    for (const node of this.nodes) {
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
    this.nodes = []
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
