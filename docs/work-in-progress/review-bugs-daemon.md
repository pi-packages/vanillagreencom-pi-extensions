# Flightdeck TS daemon run-loop bug audit

Scope: commits `59985da..HEAD` (12 commits, daemon run-loop port). Reviewed the new TS daemon modules under `skills/flightdeck/lib/flightdeck-core/src/daemon/`, the `start` wiring in `src/bin/flightdeck-daemon.ts`, `scripts/lib/subscribers.bash`, and the canonical bash daemon `skills/flightdeck/scripts/flightdeck-daemon.bash` for parity.

Validation performed:

- Read the requested TS modules and bash reference with line numbers.
- Ran `cd skills/flightdeck/lib/flightdeck-core && bun run typecheck` — pass.
- Ran targeted tests: `bun test tests/unit/busy.test.ts tests/unit/events.test.ts tests/unit/lifecycle.test.ts tests/unit/pane-meta.test.ts tests/unit/subscribers.test.ts tests/unit/wake.test.ts tests/parity/daemon-runloop.test.ts` — 49 pass, 0 fail.
- Direct SIGTERM smoke: spawned TS daemon, seeded `WAKE_PENDING`, events, heartbeat, wake-events log, sent SIGTERM. Process exited and removed pid/heartbeat/wake/events/wake-events files.
- Direct max-lifetime smoke: `FD_MAX_LIFETIME=1` produced `nohup: failed to run command '<log-file>': Permission denied` and no successor pid file.
- Direct PID-lock smoke: held the pid lock with external `flock`; TS foreground start blocked past the intended 6s/30-retry nonblocking path and ignored SIGTERM until the lock released.
- Direct tmux-window smoke: `--in-tmux-window` with per-process `FD_STATE_DIR` + TS gates timed out after 10s because the tmux child did not inherit those env gates.
- Direct subscriber parent-pid smoke: a `cc` subscriber with an idle `tail -F | jq | while read` pipeline remained alive after its parent pid died.

## Critical

1. `wakeMaster` checks busy/pending outside `SESSION_LOCK`
   - Severity: critical
   - Location: `skills/flightdeck/lib/flightdeck-core/src/daemon/wake.ts:176-207`; related stale-clear split in `skills/flightdeck/lib/flightdeck-core/src/daemon/busy.ts:127-166`
   - Description: `wakeMaster` checks `existsSync(wakePending)`, calls `isMasterBusy()`, and resolves the target before taking `SESSION_LOCK`; only the final write is locked. Bash holds `SESSION_LOCK` across the pending check, busy check, target resolution, and `WAKE_PENDING` write. `clearStaleWakePending` has the same split: it reads under the lock, releases it, checks busy/reverts maps, then reacquires for `rm`.
   - Repro/risk: master `flightdeck-state master-busy lock` writes `BUSY_FILE` and clears `WAKE_PENDING` under the same `SESSION_LOCK`. Interleaving is possible: daemon observes no busy file, master takes the lock and starts a turn, daemon then writes fresh `WAKE_PENDING` and delivers a wake during the master turn. This violates the atomic master-busy + ack contract and can wake the master mid-turn or revert dedup state after a legitimate ack.
   - Fix sketch: hold one lock across each full transition. Prefer an in-process nonblocking/blocking session-lock helper so TS can do the map updates while the lock is held; otherwise move the whole decision/write into one flock-held child and return the in-flight rows to mutate only after the file transition is complete. `wakeMaster` must not check busy/pending outside that lock.

2. PID-lock acquisition blocks and releases between probe and hold
   - Severity: critical
   - Location: `skills/flightdeck/lib/flightdeck-core/src/daemon/start.ts:121-148`
   - Description: the retry loop calls `withInprocFlock(pidLock, ...)`, but that helper uses blocking `flock(LOCK_EX)`, not nonblocking. It also releases the lock immediately, then opens a second fd and takes a second blocking lock for the daemon lifetime.
   - Repro/risk: with the pid lock held by another process, a foreground TS start blocked until the lock was released instead of failing after 30 × 0.2s; `timeout 2` did not end it until the holder released. Two concurrent starts can also both pass the probe before either holds the long-lived fd; the loser then blocks and can become a surprise daemon after the first exits.
   - Fix sketch: add/use a real nonblocking flock helper (`LOCK_EX | LOCK_NB`) and keep the same fd once acquired. The retry loop should attempt nonblocking acquisition on the lifetime fd, sleep on `EWOULDBLOCK`, and never do a probe/release before the real hold.

3. Max-lifetime successor cannot start and cleanup destroys handoff state
   - Severity: critical
   - Location: `skills/flightdeck/lib/flightdeck-core/src/daemon/lifecycle.ts:76-87,121-142`; call site `skills/flightdeck/lib/flightdeck-core/src/daemon/loop.ts:287-293`
   - Description: `maxLifetimeExec` builds `bash -c 'exec setsid nohup "$@" ... >>"$1" ... &' _ <log> setsid nohup <script> ...`, but never shifts the log path out of `$@`. The child attempts to run the log file as the command. It also omits the `start` action from `origArgs`, so even a corrected shell wrapper would invoke the trampoline with `--session` as the action. Finally, it calls `process.exit(0)`, which runs the normal EXIT cleanup and removes `PID_FILE`, heartbeat, wake/events state, and wake-events log even though the Option A design comment says those survive the handoff.
   - Repro/risk: with `FD_MAX_LIFETIME=1`, the daemon logged max-lifetime then `nohup: failed to run command '<state>/fd-daemon-s21.log': Permission denied`; no successor pid file existed. Any in-flight `WAKE_PENDING`/events state would also be removed by the parent cleanup, so the master can miss wakes across lifetime rotation.
   - Fix sketch: pass the full action argv (`start ... --foreground`) to the successor, shift the log path before executing `$@`, and preserve the TS gate/env. Add a handoff mode that suppresses normal state cleanup (or performs only deliberate subscriber cleanup) so pid/wake/event files survive until the successor rewrites/claims them.

## Important

1. tmux-window spawn does not propagate TS/state environment
   - Severity: important
   - Location: `skills/flightdeck/lib/flightdeck-core/src/daemon/start.ts:54-57`; TS gate in `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:119-156`
   - Description: the tmux-window dispatch builds a command string from `scriptPath` + args only. It does not prefix `FD_STATE_DIR`, `FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON`, `FLIGHTDECK_USE_TS_DAEMON_START`, or the daemon tuning env. A tmux server usually does not inherit arbitrary per-process env, so the child may run the bash sibling or write state in the default directory while the parent waits in the requested `FD_STATE_DIR`.
   - Repro/risk: direct `--in-tmux-window` start with temp `FD_STATE_DIR` and TS gates timed out after 10s waiting for `<temp>/fd-daemon-*.pid`. The tmux window path is recommended for several harnesses; in TS mode it can fail to start or leave a daemon running in the wrong state directory.
   - Fix sketch: construct the tmux command as `env KEY=VALUE ... <script> start ... --foreground`, carrying at least `FD_STATE_DIR`, `FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON=1`, `FLIGHTDECK_USE_TS_DAEMON_START=1`, `FLIGHTDECK_USE_TS` when set, and relevant `FD_*` tuning vars. Add a tmux-window parity test with an isolated `FD_STATE_DIR`.

2. Idle stream subscribers do not exit when parent dies
   - Severity: important
   - Location: spawn side `skills/flightdeck/lib/flightdeck-core/src/daemon/subscribers/spawn.ts:68-79`; loop bodies `skills/flightdeck/scripts/lib/subscribers.bash:205-208,265-277,401-407`
   - Description: TS spawns subscribers detached and relies on the `parent_pid` argument for self-exit. The OpenCode polling loop checks the parent every poll/sleep chunk, but Claude, Pi, and Codex stream subscribers only check `kill -0 "$parent_pid"` inside `while read` handlers. If `tail -F`, `pi-bridge stream`, or `cx_bridge_run stream` stays open and idle, the subscriber never reaches the parent check.
   - Repro/risk: a `cc` subscriber with an existing transcript and no new lines stayed alive after its parent process was killed; its `tail -F` and `jq` children were also left running. This matters more in the TS Option A max-lifetime design because successor processes can see the old live pid file, "reattach" to a subscriber whose parent pid is dead, and later lose adapter coverage when the old stream finally emits/exits.
   - Fix sketch: wrap each stream pipeline with an external parent watchdog. Options: run the stream pipeline in a process group and poll `kill -0 parent_pid` from the outer loop, killing the group when the parent dies; use timeout/read polling instead of blocking `while read`; or use tool-specific stream timeouts so the parent check runs regularly. On successor start, also validate that an existing subscriber pid belongs to the current daemon generation before reattaching.

3. Run loop wakes even when event append failed
   - Severity: important
   - Location: `skills/flightdeck/lib/flightdeck-core/src/daemon/loop.ts:339-353,412-422,443-451`; append failure path `skills/flightdeck/lib/flightdeck-core/src/daemon/events.ts:72-83`
   - Description: callers push `tickReasons`/`tickPending` and then call `appendEvent(...)`, but they ignore its boolean return. If the append fails (unwritable state dir, disk full, invalid `extraJson`, jq failure), `events.ts` rolls back dedup and returns false, but the tick still calls `wakeMaster` with the pending entry.
   - Repro/risk: the master can receive a wake, run `flightdeck-daemon ack`, and get no matching event payload. This is a silent state-corruption path: the wake happened, but the reason was never durably recorded in `EVENTS_FILE`.
   - Fix sketch: append first and only add `tickReasons`/`tickPending` when `appendEvent` returns true, or treat append failure as a hard daemon error and skip wake delivery for that tick. Log via the daemon logger with pane/hash/tag context, not only `process.stderr`.

## Nice

1. Detach spawn waits full timeout after early child failure
   - Severity: nice
   - Location: `skills/flightdeck/lib/flightdeck-core/src/daemon/start.ts:62-92`
   - Description: the detach path spawns a shell that backgrounds the daemon and returns immediately, but the parent ignores the shell-emitted child pid and only polls for the pid file until the 10s deadline. Bash also checks whether the detached child died before writing the pid file and bails early.
   - Repro/risk: start failures such as bad argv, missing env, or early foreground crash cost the full 10s and only report a generic timeout. This slows diagnosis and can hide the real foreground error in noisy logs.
   - Fix sketch: parse the child pid echoed by the detach shell and poll `kill -0` while waiting for `PID_FILE`; if it dies before writing the pid file, return immediately with the log path.

## Checked with no finding

- Direct SIGTERM cleanup path worked in the current environment: pid, heartbeat, wake-pending, events, and wake-events files were removed, and `[stop] pid=...` was logged.
- `drainOcWakeEvents` uses `lockedEventsDrain` under `SESSION_LOCK`, matching the bash snapshot/drain pattern for wake-events log lines.
- `STATE_ONLY_REQUIRED`/full dependency preflight was not changed by this range; missing `tmux` handling remains as verified in round 3.
