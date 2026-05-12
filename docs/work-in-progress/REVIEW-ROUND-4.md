# Review round 4 — daemon run-loop port fixes

Three reviewers audited commits `59985da..HEAD`. Results:
- review-bugs-daemon.md: 3 CRITICAL, 3 important, 1 nice
- review-perf-daemon.md: 0 critical, 6 important, 4 nice
- review-structure-daemon.md: 0 critical, 0 important, 1 nice (verified clean)

The 3 critical bugs are real: master-busy race, broken PID-lock,
broken max-lifetime. Don't flip the TS default until these are
fixed.

## CRITICAL — must fix

### 1. `wakeMaster` operates outside `SESSION_LOCK`
- **File:** `src/daemon/wake.ts:176-207`; related `src/daemon/busy.ts:127-166`
- **Bug:** `wakeMaster` checks `existsSync(wakePending)` and calls
  `isMasterBusy()` BEFORE taking `SESSION_LOCK`; only the final write
  is locked. `clearStaleWakePending` has the same split. Bash holds
  the lock across the entire decision + write.
- **Race:** master takes `SESSION_LOCK` between daemon's busy check
  and daemon's lock acquisition → daemon writes WAKE_PENDING during a
  master turn and delivers a wake mid-turn. Violates the atomic
  master-busy + ack contract.
- **Fix:** hold one `SESSION_LOCK` across the full transition. Either
  use the in-process flock helper (`src/shared/inproc-flock.ts`) to do
  the busy/pending check + write under the same lock, or move the
  whole decision into a single flock-held bash child. `wakeMaster`
  must not check anything outside the lock.

### 2. PID-lock acquisition blocks; 30×0.2s grace doesn't work
- **File:** `src/daemon/start.ts:121-148`
- **Bug:** the retry loop calls `withInprocFlock(pidLock, ...)` which
  uses blocking `flock(LOCK_EX)`, not nonblocking. It then releases
  immediately and re-takes the lock for the daemon lifetime — two
  daemons can both pass the probe before either claims the lifetime
  fd.
- **Repro:** holding pid lock externally with `flock`, then running
  `timeout 2 flightdeck-daemon start --foreground` blocks past 2s
  until the holder releases.
- **Fix:** add a nonblocking primitive to `inproc-flock.ts`
  (`flockTry(fd)` → returns boolean using `LOCK_EX | LOCK_NB`). Retry
  loop calls it on the lifetime fd; on `EWOULDBLOCK`, sleep 0.2s and
  retry up to 30. Once acquired, keep the same fd. No probe-release.

### 3. Max-lifetime successor broken + cleanup destroys handoff
- **File:** `src/daemon/lifecycle.ts:76-87,121-142`; call site
  `src/daemon/loop.ts:287-293`
- **Bugs (3):**
  - The bash wrapper builds `bash -c 'exec setsid nohup "$@" ...' _
    <log> setsid nohup <script> ...` but never shifts `<log>` out of
    `$@`. The successor tries to run the log file as the command,
    producing `nohup: failed to run command '<log-file>': Permission
    denied`.
  - `origArgs` reconstructed without the `start` action, so even with
    correct shell wrapper the successor sees `--session` as the
    action.
  - `process.exit(0)` runs the normal EXIT cleanup which removes
    `PID_FILE`, heartbeat, wake-pending, events, wake-events log.
    Option A is supposed to preserve those across handoff.
- **Repro:** `FD_MAX_LIFETIME=1` produces the permission-denied error
  and no successor pid file. Any in-flight wake state is destroyed.
- **Fix:** rebuild the successor invocation with the full action
  argv prepended (`start ... --foreground`). Shift the log path out
  of `$@` before exec. Add a `handoffMode: boolean` flag that
  lifecycle's EXIT cleanup respects → during handoff, skip removing
  PID_FILE / wake-pending / events / wake-events log. The successor
  rewrites PID_FILE on its own start path.

## Important — must fix

### 4. tmux-window spawn drops env (`FD_STATE_DIR`, `FLIGHTDECK_USE_TS_*`)
- **File:** `src/daemon/start.ts:54-57`
- **Bug:** the tmux-window dispatch builds a command string with just
  `scriptPath + args`. tmux server doesn't inherit caller env. Under
  isolated `FD_STATE_DIR` / TS gates, the child runs the bash sibling
  (no TS gate) or writes state to the default directory.
- **Repro:** `--in-tmux-window` with temp `FD_STATE_DIR` + TS gates
  times out (no pid file ever appears in the caller's state dir).
- **Fix:** prefix the tmux command with `env KEY=VALUE ...` carrying
  `FD_STATE_DIR`, `FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON=1`,
  `FLIGHTDECK_USE_TS_DAEMON_START=1`, `FLIGHTDECK_USE_TS` (when set),
  and any `FD_*` tuning vars. Add a parity test with isolated
  `FD_STATE_DIR` for `--in-tmux-window`.

### 5. Idle stream subscribers don't exit when parent dies (cc/pi/cx)
- **Files:** `src/daemon/subscribers/spawn.ts:68-79`,
  `scripts/lib/subscribers.bash:205-208,265-277,401-407`
- **Bug:** cc/pi/cx subscribers check `kill -0 "$parent_pid"` inside
  `while read` handlers. If `tail -F`/`pi-bridge stream`/`cx_bridge_run
  stream` stays open and idle, the inner check never runs. Parent
  dies → subscriber + pipeline children orphan. Becomes worse with
  Option A max-lifetime: successor sees the old pid file and may
  "reattach" a dead-parent subscriber.
- **Repro:** cc subscriber with existing transcript and no new lines
  stays alive after parent SIGKILL; tail/jq pipeline orphans.
- **Fix:** wrap each stream pipeline with an external parent
  watchdog. Three options (pick one or combine):
  - Run the stream pipeline in its own process group and poll
    `kill -0 parent_pid` from an outer loop in subscribers.bash;
    on failure kill the pgroup and exit.
  - Use stream timeouts (`pi-bridge stream --read-timeout 5`,
    `tail -F` polled with `read -t 5`) so the parent check runs at
    least every N seconds.
  - On successor start, validate that any existing subscriber pid
    belongs to the current daemon generation (parent_pid check) and
    kill orphans before reattaching.

### 6. Run loop wakes even when `appendEvent` failed
- **File:** `src/daemon/loop.ts:339-353,412-422,443-451`; rollback in
  `src/daemon/events.ts:72-83`
- **Bug:** callers push `tickReasons`/`tickPending` and then call
  `appendEvent(...)`, but they ignore its boolean return. On failure
  `events.ts` rolls back dedup state but the tick still calls
  `wakeMaster`. Master receives a wake, runs ack, gets no matching
  event.
- **Fix:** append first; only push `tickReasons`/`tickPending` and
  call `wakeMaster` if `appendEvent` returned true. Treat persistent
  failure as a hard daemon error (log + skip wake delivery for the
  tick). Add a unit test that forces append failure (e.g. unwritable
  state dir) and asserts no wake.

### 7. Per-tick `clearStaleWakePending` forks bash+jq under lock
- **File:** `src/daemon/busy.ts:101`; called from `loop.ts:308`
- **Bug:** every tick spawns `flock → bash → jq` to check stale
  pending state even when no pending file exists. Steady-state
  overhead: one flock+bash+jq per `FD_POLL_SEC` tick.
- **Fix:** fast-path `existsSync(wakePending)` before taking the
  lock. Only take the lock when there's something to clear or
  validate. The race window (pending file appears between existsSync
  and lock take) is acceptable — next tick handles it.

### 8. Per-tick `drainOcWakeEvents` locks empty wake-events log
- **File:** `src/daemon/subscribers/drain.ts:18`; called from
  `loop.ts:322`
- **Bug:** every tick takes `SESSION_LOCK` via `lockedEventsDrain`
  for the wake-events log, even when the file doesn't exist or is
  empty.
- **Fix:** `existsSync(wakeEventsLog) && statSync(...).size > 0`
  fast-path before the lock. Same race-tolerant tradeoff as #7.

### 9. Per-tick `touchHeartbeat` does sync `utimesSync`
- **File:** `src/daemon/lifecycle.ts:45`; called every tick at
  `loop.ts:285`
- **Bug:** filesystem write every `FD_POLL_SEC` even though the
  heartbeat log line is already gated by `heartbeatTicks`.
- **Fix:** gate `touchHeartbeat` calls by `heartbeatTicks` (same
  counter as the log line). Or introduce a separate
  `FD_HEARTBEAT_FILE_TICKS` if file mtime needs faster cadence than
  log lines.

### 10. Per-pane `pidFileAlive` rereads pid file every tick
- **File:** `src/daemon/loop.ts:259-269,374`
- **Bug:** for each subscribed pane, every tick does
  `existsSync + readFileSync + parse` on its subscriber pid file.
  With N panes that's N sync filesystem reads per `FD_POLL_SEC`.
- **Fix:** cache subscriber pid in memory when spawning/reattaching.
  Poll `process.kill(pid, 0)` each tick. Reread pid file only on
  cache miss / after max-lifetime handoff.

### 11. Per-pane `capturePane` forks tmux every tick for fallback panes
- **File:** `src/daemon/loop.ts:396`; helper `pane-meta.ts:83-90`
- **Bug:** every fallback pane pays one `tmux capture-pane`
  subprocess per tick, even when no bell/activity. Scales O(panes)
  per `FD_POLL_SEC`.
- **Fix:** use the once-per-tick `PaneCache` flags (`bell`,
  `activity`, `inMode`) to skip capture when nothing changed. After
  first hash, only re-capture on bell/activity transitions. Add a
  low-frequency sweep (every Nth tick) to catch missed signals.

### 12. `appendEvent` takes lock per event, not per tick
- **File:** `src/daemon/events.ts:35`; multiple call sites in
  `loop.ts`
- **Bug:** a single tick can append several events (subscriber drain
  + fallback bell + fallback stable). Each call independently takes
  `SESSION_LOCK` and forks `flock → bash → jq`.
- **Fix:** accumulate tick events in memory. After all per-pane
  decisions are made, batch-append under one lock acquisition per
  tick. Bonus: serialize the JSON in TS and avoid the per-event jq
  fork by passing the full JSONL blob.

## Nice — fix if time permits

- `src/daemon/pane-meta.ts:71` `sessionAlive` calls
  `tmux list-sessions` every tick on top of `PaneCache.refresh`.
  Run less often (every heartbeat interval) or infer from cache.
- `src/daemon/log.ts:32` `appendFileSync` per line; switch to a
  single append stream / buffered logger for verbose mode.
- `src/daemon/loop.ts:262` dynamic `require("node:fs")` inside hot
  helpers; hoist to module scope.
- `src/daemon/wake.ts:216` pi master pid resolved every wake; cache.
- `src/daemon/start.ts:62-92` detach path doesn't propagate child-pid
  for early-failure detection; 10s timeout on bad argv.
- `src/bin/flightdeck-daemon.ts:1-12` stale top-of-file header
  comment (review-structure-daemon nice #1) — says "start forwards to
  bash" which is no longer true.

## Tests required

For each critical, add a regression test that would have caught the
bug. Specifically:
- #1: spawn TS daemon + bash master that takes busy lock; verify
  daemon doesn't wake during the master turn (busy/pending
  consistency check).
- #2: hold pid lock externally, time the `start --foreground` retry;
  assert it fails within 6.1s of grace and returns exit 1.
- #3: `FD_MAX_LIFETIME=1` smoke: assert successor pid file appears,
  pid changes, wake-pending/events/heartbeat all survive the
  handoff.
- #4: tmux-window with isolated `FD_STATE_DIR`; assert child writes
  to that dir.
- #5: spawn cc subscriber, kill parent, wait 6s, assert subscriber
  + pipeline children are gone.
- #6: force append failure, assert no wake.

## Process

1. Critical fixes first. Each one is independently dangerous in TS
   mode and should not ship to defaults until fixed.
2. Important perf fixes (#7-#12) can land in one commit each or
   batched together — they're related (per-tick overhead).
3. Important correctness fixes (#4-#6) each need a test.
4. Nice items batch into one cleanup commit.
5. After all critical + important resolved: typecheck + bun test +
   `live-wake.sh --use-ts` re-run. Report back.

The parent will run one more reviewer sweep (smaller, targeted at
the criticals). If that's clean, parent flips per-script TS defaults
and runs final doc audit. We're close.
