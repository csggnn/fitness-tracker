# Fitness Tracker

Superset workout timer with per-set load and rep logging. Single user, single device, offline,
no backend. Data lives in IndexedDB on the device that recorded it.

The timer is a free-running metronome on a fixed slot grid. Ping `n` fires at
`anchorMs + n * slotMs`; even pings start the A exercise, odd pings start the B exercise, so one
superset set spans two slots and the A-to-A cadence is twice the slot length. The default slot is
1:15, giving the 2:30 cadence the training plan calls for.

The whole remaining ping schedule is placed on the Web Audio timeline when the session starts.
A backgrounded tab has its timers throttled and can be frozen outright, so nothing that reacts to
a tick would survive a locked screen; scheduled audio events fire regardless.

## Running it

Node is not installed on the host. Everything runs in a container.

```sh
docker compose run --rm dev npm install   # first time only
docker compose up dev                     # http://localhost:5173/fitness-tracker/
docker compose run --rm dev npm test
docker compose run --rm dev npm run build
```

Podman works with the same file via `podman-compose`.

Append `?fast` to the URL to expose 5s and 10s slot lengths, which runs a full 26-slot session in
about two minutes for testing.

## Layout

```
src/timer/grid.ts       slot index, role parity, pause/resume/jump/slot change. Pure.
src/timer/slotPlan.ts   flattens a template into one entry per slot
src/timer/audio.ts      the scheduled ping queue; the only writer to the audio timeline
src/timer/useWakeLock.ts
src/timer/useSession.ts binds the grid, the audio queue and the database
src/data/               Dexie schema, the seeded training plan, set logging
src/screens/            Today and Workout
```

## Behaviour worth knowing

- **Sets are backfilled, not ticked.** Rows are reconciled from the grid on every foreground tick
  and on every return to visibility, so a session that ran entirely with the screen off
  materialises the moment the phone is picked up.
- **Reps and loads auto-log at the target.** Editing a load applies to that set and carries to
  later sets of the same exercise; earlier rows keep what was actually used.
- **Pause replaces the skip-a-ping rule.** Pausing for one slot pair produces the same 5:00
  A-to-A gap, and any other duration works without a special case.
- **A slot length change re-anchors** to now and restarts the pair on A.
- **A reload restores a running session** from its anchor. Audio needs a user gesture, so the
  restored screen asks for one tap to re-arm the schedule.

## Storage

IndexedDB is scoped per origin per device and nothing syncs. The deployed URL is the system of
record; a session logged against `localhost` during development lives in a separate database.
