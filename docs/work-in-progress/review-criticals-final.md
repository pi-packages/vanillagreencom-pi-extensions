# Final critical verification — daemon round 4

Scope: narrow verification of critical fixes in commits `d953be7`, `1530cd4`, `84d6fb5`, plus quick scan of `3861385`, `d95cce8`, `699ea5e`.

Validation run:

- `cd skills/flightdeck/lib/flightdeck-core && bun test tests/unit/wake.test.ts tests/unit/busy.test.ts tests/parity/daemon-runloop.test.ts` — 24 pass, 0 fail.
- `cd skills/flightdeck/lib/flightdeck-core && bun test tests/parity/subscriber-watchdog.test.ts tests/unit/events.test.ts` — 9 pass, 0 fail.
- `cd skills/flightdeck/lib/flightdeck-core && bun run typecheck` — pass.
- Direct max-lifetime state-preservation repro with seeded `wake-pending`, `events`, and `wake-events` files.

## Critical #1 — verified in code; regression test is weak

`wakeMaster` now enforces the core invariant in `skills/flightdeck/lib/flightdeck-core/src/daemon/wake.ts:198-229`: the `existsSync(wakePending)` check, `isMasterBusy()` check, and temp-write/rename of `WAKE_PENDING` all run inside one `withInprocFlock(sessionLock, ...)` call. `clearStaleWakePending` similarly holds one `withInprocFlock(sessionLock, ...)` across read, busy check, TTL check, and `unlinkSync(wakePending)` at `skills/flightdeck/lib/flightdeck-core/src/daemon/busy.ts:119-139`; no different lock or post-lock final write remains.

Regression coverage is inadequate: `skills/flightdeck/lib/flightdeck-core/tests/unit/wake.test.ts:82-107` explicitly says it cannot reproduce the race and only asserts that `isMasterBusy() === true` prevents file creation. It does not simulate a master taking `SESSION_LOCK` between daemon check and write. Code inspection verifies the fix, but the promised race regression test is not actually a race test.

## Critical #2 — verified

`tryAcquireLockFd` uses `LOCK_EX | LOCK_NB` in `skills/flightdeck/lib/flightdeck-core/src/shared/inproc-flock.ts:17-18,78-87`, returning the held fd or `null` without blocking. The start path uses that same lifetime fd in the retry loop at `skills/flightdeck/lib/flightdeck-core/src/daemon/start.ts:162-175`; the probe/release/take split is gone, and the fd is retained for process lifetime.

Regression test `skills/flightdeck/lib/flightdeck-core/tests/parity/daemon-runloop.test.ts:122-153` holds the pid lock externally, starts the daemon foreground, asserts nonzero exit, matches `daemon already running.*retries`, and bounds runtime under 7s. Test passed in 6247ms, consistent with 30 × 0.2s plus startup overhead.

## Critical #3 — STILL BROKEN

The shell wrapper and parent cleanup are partially fixed: `skills/flightdeck/lib/flightdeck-core/src/daemon/lifecycle.ts:134-156` prepends `start`, shifts the log path out of `$@`, sets `handoffMode`, and `installShutdownHandlers` skips cleanup when `handoffMode` is set at `lifecycle.ts:65-99`. However the successor immediately runs normal `foregroundStart`, whose unconditional fresh-start wipe at `skills/flightdeck/lib/flightdeck-core/src/daemon/start.ts:280-281` deletes `wakePending`, `eventsFile`, and `wakeEventsLog`. That violates the handoff preservation invariant.

Regression test `skills/flightdeck/lib/flightdeck-core/tests/parity/daemon-runloop.test.ts:183-217` only checks successor pid changed, heartbeat exists, and log has `[max-lifetime]`/`[stop-handoff]`; it never seeds or asserts `wake-pending`, `events`, or `wake-events` survival. Direct repro with `FD_MAX_LIFETIME=2` and seeded files showed `pid` changed and heartbeat survived, but `wp=no ev=no wel=no` after handoff. Fix sketch: pass a handoff/resume flag or detect existing handoff state in `foregroundStart`, skip `lockedCleanupState(sessionLock, { wakePending, eventsFile, wakeEventsLog })` for max-lifetime successors, then strengthen the test to seed and assert all three files survive.

## Quick scan — other round-4 commits

No new flock anti-patterns found in a diff scan of `3861385`, `d95cce8`, and `699ea5e`; the remaining `spawnSync("flock", ...)` uses are existing command-lock helpers or whole-command locks, not the broken numeric-fd probe pattern. The #4-#6 and perf/nice regression tests listed above passed, and typecheck is clean.
