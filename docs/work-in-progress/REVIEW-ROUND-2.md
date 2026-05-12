# Review round 2 — follow-up fixes

Round 1 fixes verified: 16 items resolved, 0 critical regressions.

Remaining: 5 important + 8 nice. Reports at
`review-{perf,bugs,structure}-round2.md`.

## Important — must fix

### 1. `.env` source-failure parity (review-bugs round-2 still-broken #1)
- **File:** `src/shared/project.ts:53-70`; tests at `tests/unit/dotenv.test.ts:44-142`
- **Bug:** the bash loader script uses `set -a` but not `set -e`. A
  failing command inside `.env` does not abort sourcing. Bash
  originals run under `set -euo pipefail`; `source .env` exits
  immediately on a bare `false`. TS continues and imports later
  assignments.
- **Fix:** add `set -e` to the bash loader script before `source`.
  Add a test that runs against `.env` containing `false\nFD_AFTER=after`
  and asserts both TS and bash exit nonzero with `FD_AFTER` unset.

### 2. `ack`/`events` still slow + session-name preflight gap (review-perf important #1, review-structure important #1)
- **Files:** `src/bin/flightdeck-daemon.ts:42-48,102-114`; `src/shared/preflight.ts:20,29-35`
- **Bug:** `STATE_ONLY_REQUIRED` is `["jq","flock","bash"]` — 3 shell
  forks per `ack`/`events`. Worse, `lockedEventsDrain` doesn't
  actually call `jq` (only `flock` + `bash`); so `jq` could come out.
  Plus when `ack/events --session <name>` is called and `tmux` is
  missing, session resolution silently returns an empty key and we
  return "no daemon" instead of failing with exit 2 like bash.
- **Fix:** Two changes:
  (a) Trim `STATE_ONLY_REQUIRED` to just `["flock","bash"]`.
  (b) If the input session is `--session $<N>` or `s<N>`, skip
      tmux preflight entirely (those forms don't need tmux to resolve
      the key). If the input is a session name, include `tmux` in the
      required set so missing `tmux` exits 2.
- **Test:** parity test for `ack --session NO-SUCH` (no tmux name
  lookup needed → both implementations exit 1 "no daemon" without
  needing tmux preflight) and `status --session bogus-name` with
  PATH stripped of tmux (both exit 2).

### 3. `.env` loader forks bash per helper (review-perf important #2)
- **File:** `src/shared/project.ts:53-90`
- **Cost:** every CLI helper that needs `.env` (most of them) spawns
  bash + dumps env + re-parses. Cumulative cost across a watch tick
  is N × (~30ms bash startup).
- **Fix:** fast-path simple `KEY=VALUE` files with a native
  parser. Fall back to the bash loader only when shell syntax is
  detected (heuristic: any of `$`, backticks, `;`, `|`, `(`, command
  substitution, or `if`/`for`/`while` keywords). The native fast path
  must still match bash overwrite precedence and unquoting rules.

### 4. Pi adapter pi-bridge timeout wrapper adds extra fork per pane (review-perf new important)
- **File:** `src/bin/pane-poll.ts:335`
- **Cost:** every Pi pane poll pays one extra `timeout(1)` subprocess
  on top of pi-bridge + jq. With multiple Pi panes per tick, this
  fans out.
- **Fix:** prefer Bun async spawn with `AbortSignal` for time-bound
  reads. If pi-bridge supports a `--timeout` flag, use it natively
  and drop the wrapper. Stop-gap: only use `timeout(1)` when neither
  is available.

### 5. Tests for round-1 fixes are weak (review-bugs round-2 nice #1+#2+#3)
Three test gaps, all small:
- `pane-poll` adapter fallback has no regression test (nice #1).
  Add a parity test that creates a live pane, fakes adapter
  metadata pointing at an unreachable URL, runs under short
  `FD_ADAPTER_READ_TIMEOUT_SEC`, and asserts the tag is NOT `idle`.
- `parallel-groups clear --group 1abc2` test doesn't assert exit 2
  for TS (nice #2). Add `expect(b.status).toBe(2)`.
- Freshness cache "10 concurrent writers" test serializes (nice #3).
  Switch to async `spawn` so children actually contend.

## Nice — fix if you have time

- `lockedCleanupState` removes `heartbeat` but bash's
  `locked_state_cleanup` does not; bash leaves heartbeat for GC
  cleanup. Either remove the heartbeat unlink from
  `cmdStop`'s call or document the intentional superset.
- `parallel-groups write` does 2 jq forks per locked critical section
  — collapse into one jq program OR parse natively in the bash child.
- Daemon log `appendFileSync` per line — wire a buffered/single-stream
  logger when the daemon run-loop port lands.
- `bun:ffi` static import in `inproc-flock.ts` — guard with a dynamic
  import inside `syms()` so module load doesn't fail on platforms
  where `bun:ffi` isn't available.
- `gh` availability check forks `bash -c` per missing-worktree poll.
  Cache the result once per `pane-poll --batch`.

## After this round

Send the report message. Parent will spawn a round-3 review only if
there's residual risk. Otherwise we proceed directly to the **daemon
run-loop port** — that's the next major task (~1500 LOC bash → TS).
You should NOT start the run-loop port until parent dispatches it.
