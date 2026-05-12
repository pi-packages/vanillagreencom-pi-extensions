# Review round 6 — final final verification

Scope: only round-5 commits `71ee127` (Critical #3 successor preserves state) and `50da74f` (Critical #1 real race test).

Validation: `cd skills/flightdeck/lib/flightdeck-core && bun test tests/unit/wake.test.ts tests/parity/daemon-runloop.test.ts` — 15 pass, 0 fail.

## Critical #3 — verified

`maxLifetimeExec` now filters old handoff/spawn flags and appends exactly one successor handoff flag at `skills/flightdeck/lib/flightdeck-core/src/daemon/lifecycle.ts:149-150`: `--from-handoff` cannot accumulate across rollovers because it is in `SKIP`, then one fresh `--from-handoff` is appended. The CLI parses it at `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:163-179` and passes `fromHandoff` into `start(...)` at `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:207-225`. `foregroundStart` gates the fresh-start wipe at `skills/flightdeck/lib/flightdeck-core/src/daemon/start.ts:285-294`; the only remaining call that wipes `wakePending`, `eventsFile`, and `wakeEventsLog` on the current session is skipped when `opts.fromHandoff` is true.

Regression coverage is now meaningful. `skills/flightdeck/lib/flightdeck-core/tests/parity/daemon-runloop.test.ts:212-221` seeds `wake-pending`, `events.jsonl`, and `wake-events.log`; `daemon-runloop.test.ts:250-261` asserts `wake-pending` and `events.jsonl` retain sentinels and that the wake-events row survived long enough for successor run-loop drain by checking `hSURVIVE_WEL` in `events.jsonl`. This catches the prior successor wipe; the narrow test passed.

## Critical #1 — verified

`wakeMaster` still holds one `withInprocFlock(sessionLock, ...)` around the in-flight check, `isMasterBusy()`, optional test delay, and pending-file write at `skills/flightdeck/lib/flightdeck-core/src/daemon/wake.ts:201-240`. The `FD_WAKE_TEST_DELAY_MS` seam is contained at `wake.ts:211-221`; when unset it does no sleep and changes no behavior.

The new regression test is a real concurrent lock test: `skills/flightdeck/lib/flightdeck-core/tests/unit/wake.test.ts:82-135` spawns a `flock(1)` worker that holds `SESSION_LOCK` for 500ms, waits 100ms, calls `wakeMaster`, and asserts the call takes at least 300ms. That proves `wakeMaster` blocks on the same flock instead of bypassing it; the test passed in 556ms.

Result: both round-5 fixes hold. No still-broken cases found in the requested scope.
