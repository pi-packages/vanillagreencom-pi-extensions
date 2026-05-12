# Performance audit — daemon run-loop TS port

Scope: commits `59985da..HEAD`. Hot path = long-running daemon tick every `FD_POLL_SEC` plus subscriber event drains.

## CRITICAL

- None.

## IMPORTANT

- `src/daemon/busy.ts:101`: Every run-loop tick calls `clearStaleWakePending` (`src/daemon/loop.ts:308`) before checking whether `WAKE_PENDING` exists. In the normal no-pending case this still spawns `flock -> bash`, then runs jq checks inside `readScript` (`src/daemon/busy.ts:127` and `src/daemon/busy.ts:138`) once per `FD_POLL_SEC` tick.
  Suggested fix: Add a cheap `existsSync(wakePending)` fast-path before taking `SESSION_LOCK`, or keep an in-memory `wakePendingMaybePresent` flag and only run the locked jq path after wake delivery/failure states.

- `src/daemon/subscribers/drain.ts:18`: Every tick drains subscriber wake-events via `drainOcWakeEvents` (`src/daemon/loop.ts:322`) even when the wake-events log is absent/empty. The wrapper calls `lockedEventsDrain` at `src/daemon/subscribers/drain.ts:19`, so the empty steady state still pays a `flock`/bash critical section per tick.
  Suggested fix: Fast-path `existsSync(wakeEventsLog)` before locking; accepting next-tick delivery for a race after the existence check is cheaper than steady-state per-tick fork+lock.

- `src/daemon/lifecycle.ts:45`: Heartbeat file mtime is updated every tick via `touchHeartbeat(heartbeatFile)` at `src/daemon/loop.ts:285`; `touchHeartbeat` performs sync `utimesSync` at `src/daemon/lifecycle.ts:48`. This is fixed filesystem I/O every `FD_POLL_SEC` even though heartbeat log cadence is already gated by `heartbeatTicks` at `src/daemon/loop.ts:461`.
  Suggested fix: Gate heartbeat file writes with a separate counter (or reuse `heartbeatTicks`/a shorter `FD_HEARTBEAT_FILE_TICKS`) so it writes once per N ticks, not every tick.

- `src/daemon/loop.ts:371`: Subscribed panes avoid `capture-pane`, but each subscribed pane still rereads its subscriber pid file every tick via `pidFileAlive` (`src/daemon/loop.ts:374`). That helper does `existsSync` + `readFileSync` + parse per subscribed pane (`src/daemon/loop.ts:259`–`src/daemon/loop.ts:269`), so N adapter panes add N sync filesystem reads each tick.
  Suggested fix: Store subscriber pid in memory when spawning/reattaching and poll `process.kill(pid, 0)` each tick. Re-read pid file only if the cached pid dies or after max-lifetime handoff.

- `src/daemon/loop.ts:396`: Fallback panes pay one `tmux capture-pane` subprocess per pane per tick, regardless of bell/activity state. The capture path calls `capturePane` (`src/daemon/pane-meta.ts:83`–`src/daemon/pane-meta.ts:90`) and then hashes the full buffer at `src/daemon/loop.ts:397`; with many non-adapter panes this scales as O(panes) tmux forks every `FD_POLL_SEC`.
  Suggested fix: Use the once-per-tick `PaneCache` flags (`bell`, `activity`, `inMode`) to skip capture for unchanged idle panes after initial hash, plus a lower-frequency sweep to catch missed activity.

- `src/daemon/events.ts:35`: Each canonical event append takes `SESSION_LOCK` and spawns `flock -> bash -> jq` (`src/daemon/events.ts:72`). A single tick can append multiple events from subscriber drain (`src/daemon/loop.ts:349`) and fallback bell/stable branches (`src/daemon/loop.ts:418`, `src/daemon/loop.ts:447`), causing repeated lock acquisitions and jq forks before the final wake.
  Suggested fix: Accumulate tick events in memory and append/extend `WAKE_PENDING.in_flight` once under `SESSION_LOCK` per tick; serialize all JSON in TS and avoid per-event jq.

## NICE

- `src/daemon/pane-meta.ts:71`: `sessionAlive` runs `tmux list-sessions` every tick (`src/daemon/loop.ts:296`) in addition to the required once-per-tick `PaneCache.refresh` (`src/daemon/loop.ts:301`, `src/daemon/pane-meta.ts:25`). This is an extra tmux subprocess per tick that could be inferred from the pane cache/master liveness in most cases.
  Suggested fix: Check session existence less often (e.g. every heartbeat interval) or rely on master pane disappearance from the refreshed pane cache for the normal exit path.

- `src/daemon/log.ts:32`: Run-loop logging is not per tick in normal mode: heartbeat logs are gated by `heartbeatTicks` (`src/daemon/loop.ts:461`), and most other logs are event/error driven. Still, each log line uses sync `appendFileSync` (`src/daemon/log.ts:32`), so bursty canonical events or verbose mode can block the loop on disk.
  Suggested fix: Keep default cadence, but switch to a single append stream or small buffered logger before enabling verbose logs in production.

- `src/daemon/loop.ts:262`: Several helpers do dynamic `require("node:fs")` inside hot loops (`pidFileAlive` at `src/daemon/loop.ts:262`, `touchOcBellMarker` at `src/daemon/loop.ts:279`, heartbeat status at `src/daemon/loop.ts:465`). Module cache keeps this modest, but it still creates avoidable per-call lookup/object churn.
  Suggested fix: Hoist fs imports to module scope and reuse them in the tick body.

- `src/daemon/wake.ts:216`: Pi wake delivery resolves the master bridge pid on every wake. `resolvePiMasterPid` runs `pi-bridge list` (`src/daemon/wake.ts:62`), `tmux display-message` (`src/daemon/wake.ts:70`), a `ps` snapshot (`src/daemon/wake.ts:24`), and fallback `pgrep`/`readlink` scans (`src/daemon/wake.ts:100`–`src/daemon/wake.ts:123`) before `pi-bridge send` at `src/daemon/wake.ts:220`.
  Suggested fix: Cache the resolved Pi master pid for the master pane and invalidate only when `process.kill(pid, 0)` fails or the pane id changes.

<output_format>{"file":"docs/work-in-progress/review-perf-daemon.md","counts":{"critical":0,"important":6,"nice":4},"summary":"Run-loop avoids per-pane adapter subprocesses, but empty-tick lock drains, heartbeat writes, and fallback captures still add steady-state cost"}</output_format>
