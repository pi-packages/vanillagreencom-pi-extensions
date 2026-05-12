# Review round 1 — session-2 follow-up fixes

Three reviewer agents audited commits `69cda24..HEAD`. Zero criticals,
9 important + 10 nice findings. Reports:
`review-{perf,bugs,structure}-session2.md`.

This file is the dispatch list for the next iteration. Fix all
IMPORTANT items below; NICE items can be addressed in the same batch
or deferred with a one-line note.

## Important — must fix

### 1. `.env` loader still drops bash precedence
- **File:** `src/shared/project.ts:40-94`
- **Bug:** the loader refuses to import any key that already exists in
  `process.env` (lines 91-93), but `source .env.local` in bash
  overwrites by default. With `FD_STATE_DIR=preset` exported and
  `.env` containing `FD_STATE_DIR=from-env`, bash uses `from-env`; TS
  keeps `preset`. State files end up in different directories between
  bash and TS implementations.
- **Also:** `source` failures emit a warning and continue (lines
  65-67); bash runs under `set -e` and stops.
- **Fix:** after the bash child sources the file, assign declared keys
  from the child environment unconditionally so `.env*` overrides
  inherited env (matches bash). On `source` failure, exit nonzero.
- **Test:** add a parity test that exports `FD_TEST_OVER=preset`,
  writes `.env` with `FD_TEST_OVER=from-env`, and asserts both bash
  and TS see `from-env`.

### 2. `lockedStateCleanup` is not actually locked and misses wake-events
- **File:** `src/bin/flightdeck-daemon.ts:272-290` (helper), `:354` (call)
- **Bug:** direct `unlinkSync` of wakePending / eventsFile /
  heartbeatFile / `.draining.*` with no session lock. Bash
  `locked_state_cleanup` takes `SESSION_LOCK` first. Also misses
  `fd-wake-events-${sessionKey}.log` and its `.draining.*` snapshots
  (review-triage said wake-events cleanup was included but it isn't).
- **Fix:** wrap the cleanup in a `lockedEventsDrain`-style flock-held
  bash script that removes all 5 file families under the lock. Add a
  path helper `fdWakeEventsLog(stateDir, sessionKey)` if not already
  in `paths/daemon.ts`.

### 3. `parallel-groups clear --group N` regex sanitization mutates input
- **File:** `src/bin/parallel-groups.ts:140-141`
- **Bug:** `groupId.replace(/[^0-9-]/g, "")` transforms `1abc2` into
  `12` and silently deletes group `12`. Bash original used `--argjson
  gid "$group_id"` which would reject the input.
- **Fix:** validate `groupId` with `/^-?\\d+$/` before acquiring the
  lock; reject with exit 2. Then pass as a numeric arg to a locked jq
  call using `--argjson`.
- **Test:** add a parity test invoking `clear --group 1abc2` against a
  state with groups `1` and `12`; assert both implementations exit 2
  (no mutation).

### 4. Preflight `REQUIRED` doesn't match bash daemon
- **Files:** `src/shared/preflight.ts:1-10,35-41`,
  `src/bin/flightdeck-daemon.ts:41,96`
- **Bug:** bash daemon's `_check_deps_inline` requires
  `tmux jq flock awk sha256sum` (exits 2 on miss). TS `REQUIRED` only
  has `jq flock bash`. TS exits 127 (status from missing command)
  instead of 2. Missing `tmux` lets `flightdeck-daemon status` fall
  through to "no daemon" instead of failing cleanly.
- **Fix:** add `tmux awk sha256sum` to `REQUIRED` (mark `bash` itself
  is implicit). Change exit code to 2 to match bash. Apply the
  preflight to `parallel-groups` and other CLI entries that use jq.

### 5. `pane-poll` adapter read timeout doesn't trigger tmux fallback
- **Files:** `src/bin/pane-poll.ts:296-303,313-325,329-342` (TS code),
  `skills/flightdeck/README.md:62` + `skills/flightdeck/SKILL.md:210`
  (docs)
- **Bug:** docs say `FD_ADAPTER_READ_TIMEOUT_SEC` "bounds adapter
  reads and falls through to tmux capture" on stale adapters. Code
  sets `ocUsed`/`piUsed`/`cxUsed` as soon as fresh args exist; on
  timeout/non-zero exit it leaves `buf` empty AND still skips the
  tmux capture branch because `adapterUsed` is true. Either code or
  docs is wrong.
- **Fix:** preferred — make adapter read failure (status !== 0 OR
  empty stdout) clear the `*Used` flag so the tmux fallback engages.
  Adjust the docs only if the existing code behavior is actually
  what we want.
- **Test:** parity test using a fake URL (curl will timeout); assert
  the resulting JSON `tag` is not `idle` (tmux fallback ran).

### 6. Freshness cache hot-path multi-fork
- **File:** `src/paths/daemon.ts:62-85`
- **Cost:** every pane's freshness probe pays
  `flock → bash → jq -e → jq update` per cache miss. With N panes
  per tick and TTL expiry, this is N × ~4 forks before any adapter
  read.
- **Fix:** keep the lock fix but read/modify/write the cache natively
  in TS under the lock (read JSON once, mutate in-process, write
  once). Optionally batch updates per `pane-poll --batch` and flush
  at end.

### 7. Preflight runs unconditionally for `ack`/`events`
- **File:** `src/bin/flightdeck-daemon.ts:41`
- **Cost:** turn-end CLI path: 3 separate `command -v` shell forks
  per `ack`/`events` invocation, even though those actions only need
  `flock` (one dep).
- **Fix:** call preflight with the action-specific required set; for
  `ack`/`events`, `["flock"]`. For `start`/`stop`/`health`, the full
  set including `tmux`.

### 8. README test count is stale
- **File:** `skills/flightdeck/README.md:178-181`
- **Bug:** says "Currently 90+ tests across 11 files". Actual: 106
  across 14.
- **Fix:** either update the number or drop the specific count.

## Nice — fix if you have time

- **gc twice-passes** the same `readdirSync` result
  (`src/daemon/gc.ts:53,83`). Combine into one pass.
- **Daemon log append failures swallowed**
  (`src/daemon/log.ts:28-41`). Emit a one-time stderr warning when
  appending fails.
- **Freshness cache silently resets corrupt JSON**
  (`src/paths/daemon.ts:74-76`). Rotate corrupt file to
  `.corrupt.<ts>` before reinitializing.
- **Relative FD_STATE_DIR memoization** (`src/paths/daemon.ts:15-32`)
  doesn't include `process.cwd()` in the cache key. Resolve relative
  path to absolute at load time.
- **`collectDescendants` O(processes) forks**
  (`src/bin/flightdeck-daemon.ts:252`). Use one `ps` snapshot and
  build the tree in memory.
- **`wakePayloadForHarness` toLowerCase drift** (intentional, keep
  unless docs disagree).

## Process

1. Read each finding's report file for full context.
2. Fix in order — earliest priority gets earliest commit.
3. Add tests for any fix that addresses a previously-untested bug.
4. After all important items: `bun test` (expect 110+ passing now),
   `bun run typecheck`, commit batch.
5. Send a final report via pi-bridge with the new commit list.

The parent will run another reviewer sweep on your fixes. Expect
either "approved, proceed to live-test" or one more focused round.
