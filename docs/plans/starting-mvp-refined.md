# Fitness Tracker MVP: Refined Plan

## Goal
A personal tool that runs a superset workout on a fixed interval cadence, records loads and reps,
and reports weight progression and workout history. Single user, single device, offline.

---

## Decisions

These were open questions in the previous draft. Defaults are chosen so implementation can start.

| Area | Decision | Rationale |
|---|---|---|
| Platform | Installable PWA, Chrome on Android | One codebase, no store, meets "web based" |
| Storage | IndexedDB, local only | Removes backend, auth, and sync from the MVP |
| Backup | Manual JSON export / import | Replaces cloud sync for data durability |
| Accounts | None | Single user; device lock screen is the access control |
| Backend | None; static hosting | No data leaves the device, so confidentiality is structural |
| Rep logging | During the workout, per set, prefilled with the target | One tap when the target is hit |
| Timer scope | One global slot length per session (default 1:15), adjustable mid-session | A and B each get a cued start; two slots make the 2:30 A-to-A cadence |
| Load granularity | 0.5 kg | Covers both 2 kg and 2.5 kg plate increments |
| Attendance | Calendar of completed sessions; no planned schedule | Skip detection needs a training-day schedule that does not exist |
| Stack | TypeScript, React, Vite, Dexie, vite-plugin-pwa, uPlot | Static build, no server runtime |

Deferred until the MVP is in use: cloud sync, multi-device, notifications, multiple templates.

---

## Timer engine

The timer is the critical path. The phone screen will be off and the tab backgrounded during sets.

### Model
The timer is a free-running metronome on a fixed slot grid, not a per-set countdown.

- Session stores `anchorMs` (epoch ms of the first A-start) and `slotMs` (default 75000).
- Ping `n` fires at `anchorMs + n * slotMs`.
- Even `n` starts the A exercise, odd `n` starts the B exercise. One superset set spans two slots,
  so A-to-A is 2:30 while both movements get their own cue.
- The two pings use distinct tones (A: double beep, B: single beep). The cue must be identifiable
  without looking at the screen.
- Current position is always derived from `Date.now()`, never accumulated from previous ticks.
- Sets consume slot pairs: A on even parity, B on odd.
- Changing the slot length mid-session (1:15 to 1:22) re-anchors: `anchorMs = now`, cursor resets to
  the current pair at parity 0.
- The finisher (140s plank) spans two slots. It is a `single` block, so both of its pings are
  informational; no set advances on the first.

### Controls
Pause, resume, and jump are all translations of `anchorMs`. The grid is never rebuilt and A/B parity
is never inverted, so no control can desynchronize the session.

- **Pause.** Store `pausedAt = now`. While paused, the effective clock is `pausedAt` rather than
  `Date.now()`, so the countdown holds at whatever remained.
- **Resume.** `anchorMs += now - pausedAt`, then clear `pausedAt`. Every future ping shifts by the
  paused duration, so the time left in the current slot is exactly what it was at pause.
  `totalPausedMs` accumulates the same delta for reporting.
- **Jump to next.** `anchorMs -= msUntilNextPing`. The next ping fires immediately and the following
  slot starts a full `slotMs` from now.
- Pausing replaces the training plan's skip-a-ping fatigue rule: a pause of one slot pair produces
  the same 5:00 A-to-A gap, and any other duration is available without a special case.
- Pause is allowed at any point, mid-set or mid-rest. The timer holds the phase and attaches no
  meaning to when it was pressed.

### Background execution
A hidden tab has its timers throttled to >=1s, then to roughly once per minute under intensive
throttling, and the page can be frozen outright. After the screen locks, JS may never run again for
the rest of the session. No design that reacts to a tick can survive this.

The audio timeline therefore holds the entire schedule, and JS liveness is not required for
correctness.

- Create the `AudioContext` inside the "Start workout" tap. Autoplay policy requires a user gesture.
- Schedule **every remaining ping** of the session up front, with `oscillator.start(when)` computed
  from `anchorMs` against `AudioContext.currentTime`. Scheduled Web Audio events are sample-accurate
  and fire whether or not the page is running.
- A 30 minute session is roughly 24 nodes. There is no lookahead window to tune and no rescheduling
  loop. Scheduling one ping ahead would end the session at the first ping after the screen locks.
- Keep a silent looping source connected for the session duration. It marks the page as playing
  audio, which is what keeps the `AudioContext` from being suspended in the background.
- Any control that moves `anchorMs` invalidates the whole queue. Keep references to the scheduled
  nodes, stop and disconnect them all, then rebuild from the new anchor. This is the only path that
  writes to the audio timeline, and it runs on start, pause, resume, jump, and slot length change.
- Rebuild nothing while `pausedAt` is set. Pause stops and drops the queue; resume rebuilds it.
- The queue is expressed in audio-clock time through one measured mapping to the system clock. That
  mapping decays: the audio clock stops advancing while the context is suspended and runs at its own
  rate otherwise. Re-measure it on every foreground tick and re-anchor the queue once the slip
  exceeds a threshold, so a session that spent time with the screen locked does not run late.
- Correct towards the system clock, not the audio clock. The countdown and `anchorMs` are both in
  system time, so correcting the other way would keep the two displays consistent by drifting the
  actual cadence of the session.
- A re-anchoring requeues only slots the countdown has not passed, and leaves a ping that is already
  sounding to finish. A cue may be dropped by a correction; it is never doubled or cut mid-beep.
- Hold a `navigator.wakeLock.request('screen')` for the session duration, including while paused.
  Re-acquire on `visibilitychange`, since the lock is released when the tab hides.
- Foreground ticks drive the countdown display only. They never schedule audio.
- On returning to the foreground, recompute set and slot index from elapsed time rather than
  restoring a stored counter.

### Requirements
- Ping timing accurate to within one audio buffer of the grid. Measured against `anchorMs`,
  not against wall-clock render time.
- The beep and the countdown stay within 200 ms of each other for a whole session, including one
  that spends time suspended. The error does not accumulate: it is bounded, not merely small.
- The workout screen names the next exercise and its load before the ping that starts it, so the
  plate change can be made during the preceding rest.
- Pings continue with the screen off and the browser backgrounded for a full 30 minute session.
- Session state survives a tab reload: reopening restores the running timer from `anchorMs`, or the
  frozen countdown if `pausedAt` is set.
- A paused session left overnight resumes with the same time remaining, not an elapsed one.

### Verification
- Unit tests over the grid function: slot index and parity from elapsed time, slot length change,
  and return to the foreground after a gap larger than one pair.
- Unit tests over the controls: time remaining is preserved across pause and resume for an arbitrary
  pause duration; jump advances exactly one slot; parity holds after any sequence of the three.
- Unit test that a rebuild cancels every previously scheduled node, against a mocked `AudioContext`.
  A leaked node is inaudible in unit tests and wrong only on the gym floor.
- Simulation of a full session against an audio clock that runs at its own rate and stalls while
  suspended, asserting the error between each beep and its slot on the countdown. Run with the
  correction disabled it reproduces the fault: a 3 second stall leaves every subsequent ping that
  far behind.
- `?debug` on the workout screen reports the current slip and the number of corrections, so a
  session on the target device can be checked without instrumentation.
- Manual test: 30 minute run with the screen locked, on the target device. This is the only check
  that covers freezing and audio suspension, so it gates milestone 1.

---

## Data model

```
ExerciseTemplate  id, name, equipment, unilateral, loadStep, defaultReps[]
WorkoutTemplate   id, name, blocks[]
Block             kind (warmup | superset | single | finisher), exerciseA, exerciseB?, sets, targetReps
Session           id, templateId, date, status, anchorMs, slotMs, pausedAt?, totalPausedMs,
                  startedAt, endedAt, note
SetLog            id, sessionId, exerciseId, role (A | B), setIndex, slotIndex, startedAt,
                  targetReps, actualReps, load, completed
```

- `load` is total kilograms as a multiple of 0.5. Per-side loads are entered as their total; the
  training plan now records the incline press as 50 kg (10 kg bar plus 20 kg per side).
- `loadStep` is the increment used by the plus and minus controls, 2 or 2.5 depending on the
  available plates. It affects entry only, not storage.
- `targetReps` is one number per block, applied to every set of that block. Per-set rep schemes such
  as `12 / 10 / 8` are not supported; a block with a different target is a different block.
- Each superset set produces two `SetLog` rows, one per role. `startedAt` is the slot ping time, so
  both A and B start times are recorded.
- `SetLog.load` records what was actually used, so a mid-session load change is captured per set.
  This subsumes the "attempted vs completed load" idea without a second field.
- `pausedAt` is present only while paused, and is what makes the paused state survive a reload.
  `totalPausedMs` separates elapsed session time from working time in the history view.
- PRs, volume, and session counts are derived on read. Storing them creates a second source of truth
  that can disagree with the set logs.

---

## Screens

1. **Today.** Start button. Last session summary.
2. **Workout.** The only screen used in the gym. Must be readable at arm's length.
   - Time to next ping, large, with the upcoming role (A or B) named, the exercise it belongs to,
     and the load that exercise will be performed at. The load is what the plate change is made
     from, so it must be readable before the ping rather than after the set starts.
   - Current superset: A and B side by side, active one highlighted. Each card carries the target
     reps and the load for its exercise. Loaded work reads `10 × 50 kg`; bodyweight work reads
     `10 reps` and carries no load clause.
   - Set counter.
   - Rep entry prefilled with the target; tap to confirm, adjust if different.
   - Load field showing last session's value; plus and minus step by the exercise's `loadStep`.
   - Pause and resume as one toggle, jump-to-next, and slot length. The first two are the controls
     reached mid-set with one hand, so they take the largest hit targets after the countdown.
   - Paused state is visually unmistakable. A held countdown and a running one must not look alike.
3. **History.** Calendar grid of the last 3 months, completed sessions marked. No planned or skipped
   state. Tapping a day opens that session's set logs.
4. **Progress.** Load over time per exercise, one exercise at a time, session granularity.
   Reps per set shown as a table under the chart.
5. **Settings.** Template editing, default slot length, export, import.

---

## Onboarding

Ship the training plan as a seeded template. First launch loads it with the loads already filled in.
No setup flow, no manual exercise entry, no import. Editing the seeded template covers the rest.

Bar weight is assumed to be 10 kg and folded into the seeded total. Only the change in load over
time is tracked, so an inaccurate bar weight shifts every incline press value by a constant and does
not affect progression.

---

## Milestones

1. **Timer.** Grid engine, scheduled audio, wake lock, background verification. No persistence.
2. **Session logging.** Seeded template, workout screen, set logs in IndexedDB, resume after reload.
3. **History and progress.** Calendar of completed sessions, load chart.
4. **Durability.** JSON export and import, PWA install and offline shell.

Milestone 1 is a standalone deliverable: it is usable in the gym on its own, and it retires the only
technical risk in the project.

---

## Out of scope

Social features, multiple concurrent templates, form videos, calorie tracking, wearable integration,
cloud sync, accounts, push notifications, multi-device conflict resolution.

Notifications are excluded because Web Push requires a server and a subscription endpoint, which
reintroduces the backend this plan removes. Attendance is visible on the History screen instead.

Encryption at rest is excluded. It requires a passphrase on every launch to be meaningful, and the
data does not leave the device. Revisit only if sync is added.

Planned training days and skip detection are excluded. History shows sessions that happened.