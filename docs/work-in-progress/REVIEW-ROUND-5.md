# Review round 5 — final critical verification

The narrow verification reviewer caught one critical that is NOT
actually fixed and two regression tests that don't actually test the
regression. Report: `review-criticals-final.md`.

## CRITICAL — must fix

### 1. Critical #3 (max-lifetime handoff state preservation) STILL BROKEN
- **Files:** `src/daemon/start.ts:280-281` (unconditional wipe);
  `src/daemon/lifecycle.ts:65-99,134-156` (handoff mode + parent skip)
- **What got fixed:** parent's EXIT cleanup correctly skips when
  `handoffMode` is set. Shell wrapper is correct. `start` prepended.
- **What's STILL broken:** the successor's `foregroundStart` runs an
  unconditional fresh-start wipe at `start.ts:280-281` that deletes
  `wakePending`, `eventsFile`, and `wakeEventsLog`. The state files
  the parent preserved are wiped seconds later by the successor.
- **Repro:** `FD_MAX_LIFETIME=2` with seeded wake-pending + events +
  wake-events.log → after handoff: parent skipped cleanup correctly,
  but `wp=no ev=no wel=no` because the successor wiped them.
- **Fix:**
  - Pass a `--from-handoff` flag (or equivalent env var) from the
    parent's successor spawn invocation.
  - `foregroundStart` reads that flag; when set, skip the
    `lockedCleanupState({ wakePending, eventsFile, wakeEventsLog })`
    call.
  - OR: detect existing handoff state in `foregroundStart` (e.g.
    presence of a sentinel file written by the parent before
    exiting, removed by the successor after consuming).

### 2. Regression test for Critical #1 doesn't actually test the race
- **File:** `tests/unit/wake.test.ts:82-107`
- **What it does now:** asserts `isMasterBusy() === true` prevents
  file creation. That's a state assertion, not a race.
- **The race it claims to cover:** daemon checks busy → master takes
  busy lock → daemon writes WAKE_PENDING → mid-turn wake delivered.
- **Fix:** add a real race test:
  - Spawn a worker that takes `SESSION_LOCK` and sets the busy file.
  - From the main test thread, call `wakeMaster()` concurrently.
  - Use a small artificial delay (`process.env.FD_WAKE_TEST_DELAY_MS`)
    inside `wakeMaster` between busy-check and write — or wire a
    test-only seam in `wake.ts` — so the race window is observable.
  - Assert: under the test seam, `wakeMaster` either blocks on the
    lock or observes the busy state set by the worker. Never both
    "no busy at check time" AND "wrote WAKE_PENDING after busy was
    set".
  - Failing the assertion means the fix has regressed.

### 3. Regression test for Critical #3 doesn't actually check state survival
- **File:** `tests/parity/daemon-runloop.test.ts:183-217`
- **What it does now:** asserts successor pid changed, heartbeat
  exists, daemon log contains `[max-lifetime]`/`[stop-handoff]`.
  None of that verifies the state files actually survived.
- **Fix:** before triggering max-lifetime, seed all three files:
  ```
  echo '{"in_flight":[]}' > wake-pending
  echo '{"hash":"xxx"}' >> events.jsonl
  echo '{"ts":...}' >> wake-events.log
  ```
  After the handoff completes, assert all three files still exist
  AND contain the seeded content (verifying they weren't truncated
  and rewritten).

## Process

Three commits expected (one per item; small fixes). After landing,
re-run the same narrow reviewer scope.

After these are clean: parent flips per-script TS defaults and runs
the final doc audit.

## Why this round matters

The TS daemon under TS gate (`FLIGHTDECK_USE_TS_DAEMON_START=1`)
will, on `FD_MAX_LIFETIME` rotation, silently drop any in-flight
wake-pending and unacknowledged events. Master would lose those
events forever. That's a real production data-loss bug that the
deflict-test mode would have masked.
