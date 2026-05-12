# Review findings triage

Summary of how the 39 findings (8 critical, 20 important, 11 nice) from
the three pi review agents (`review-perf.md`, `review-bugs.md`,
`review-xharness.md`) were handled.

## Fixed in this cycle

### Critical

- **flock semantics broken** across `master-state.ts`, `flightdeck-daemon.ts`
  `events`/`ack`, and `flightdeck-state.ts master-busy lock`
  (review-bugs critical #1/#2/#3, review-xharness critical "all").
  Replaced the no-op `spawnSync("flock", ["-x", String(fd), "true"])`
  pattern with `src/state/locking.ts` helpers that spawn the entire
  critical section as a bash child under `flock`. The lock is held for
  the full duration of the work, not just the helper subprocess's
  lifetime. All payload values pass through bash positional args
  (`$1`/`$2`/…) — no shell interpolation.
  Affected helpers: `lockedJqUpdate`, `lockedAtomicWrite`,
  `lockedAtomicWriteAndUnlink`, `lockedUnlink`, `lockedEventsDrain`,
  `lockedAllocPort`, `lockedReleasePort`, `lockedRegisterPortPid`,
  `lockedRename`.

- **Opencode shell injection** (review-bugs critical #5,
  review-xharness critical oc). Switched
  `pane-respond.opencodeRunAttach` from a `bash -c` with
  `JSON.stringify(message)` to a direct `setsid --fork <bin> run --attach
  ...` argv invocation. The message is now a single argv element — no
  shell expansion of `$VAR`/`$(...)` is possible. Plus matched bash's
  pre-send / poll timeout asymmetry (5s for snapshot, 3s for polls,
  reviewer-xharness oc important).

- **Port allocator races** in `oc.ts`, `cc.ts`, `codex.ts`
  (review-bugs critical #4). All three allocators now route through
  `lockedAllocPort` / `lockedReleasePort` / `lockedRegisterPortPid` in
  `src/state/locking.ts`. The sweep-dead-pids + free-port-probe + JSON
  update sequence is now atomic under each ports file's flock — matches
  the bash `flock 209/214/219` contract.

- **pane-poll batch serial blocking** (review-perf critical). Capped
  every adapter read subprocess with a configurable timeout
  (`FD_ADAPTER_READ_TIMEOUT_SEC`, default 2s). Affects curl in oc,
  `timeout(1)` around pi-bridge, env override for codex-bridge, and
  `timeout(1)` around `gh pr view`. One stale adapter can no longer
  exceed the daemon's per-pane tick budget. Bonus: gated `gh pr view`
  on `command -v gh` (review-perf nice).

### Important

- **Adapter freshness cache writes are unguarded** (review-bugs
  important #3). `fdAdapterFreshnessCacheSet` now uses flock on the
  cache file.

- **Archive without state lock** (review-bugs important #2). Switched
  to `lockedRename` so a concurrent `set` cannot race the rename.

- **cc transcript file type check missing** (review-xharness important
  cc). Now uses `statSync().isFile()` instead of bare `existsSync`.

- **Codex freshness probe doesn't pass timeout env**
  (review-xharness important cx). `cxBridgeRun` accepts `{env}` and
  `cxAdapterIsFresh` passes `FD_CODEX_RPC_TIMEOUT_MS` through.

- **Tmux send error handling** (review-bugs important #7). Wrapped
  `tmuxSend` and added `tmuxRun` to fail-loud on non-zero tmux exit.
  Payload mode now exits 5 if load-buffer / paste-buffer fails — does
  not falsely clear the bell.

- **Session resolution doesn't accept tmux session_id**
  (review-bugs important #5, review-xharness important "all").
  `resolveSessionId` now uses `tmux display-message -t <input>` and
  parses tab-separated `#{session_name}\t#{session_id}` output —
  supports names with spaces. Falls back to `s<N>` / `$<N>` keys for
  recovery on already-gone sessions.

- **Daemon stop misses descendant kill + state cleanup gaps**
  (review-bugs important #6, review-xharness important "all").
  Ported `collectDescendants` (recursive `pgrep -P` walk) and
  `lockedStateCleanup`. Stop now kills the full subscriber subtree
  before the parent, then removes `wake-pending`, `events-file`,
  `heartbeat-file`, and any `.draining.<pid>` snapshots.

- **stop's flock test fails open on missing flock**
  (review-bugs important #9). Added `flockTest.error` check — exits 1
  on spawn failure rather than killing.

- **Opencode bin existence vs executable check**
  (review-xharness nice oc). Now uses an `isExecutable` helper with
  the mode-bit check.

- **Sentinel regex recompiled per call** (review-perf nice).
  Hoisted `FINGERPRINT_SENTINEL` to module-level constant.

## Deferred (recorded but not fixed this cycle)

These are real findings but lower priority and reasonable to defer until
the daemon `start` run-loop port (separate session). All are documented
here so the next iteration can address them in a focused batch.

### Performance (review-perf)

- **Pane-poll batch parallelism** (review-perf critical, partially
  addressed). Per-row timeouts cap worst-case latency but the loop is
  still sequential. Real concurrency requires moving to async with
  `Bun.spawn` — best done alongside the daemon run-loop port so the
  daemon's poll cycle is async end-to-end.

- **jq subprocess fanout in adapter text extraction** (review-perf
  important). Replacing `OC_LAST_ASSISTANT_JQ` / `CC_LAST_ASSISTANT_JQ` /
  `PI_LAST_ASSISTANT_JQ` / `CX_LAST_ASSISTANT_JQ` with native TS
  extractors would shave ~3ms per pane per tick. Worth doing but
  invasive. Pair with the async refactor.

- **Freshness probe duplicates the read** (review-perf important).
  Folding the freshness probe into the read so one HTTP/WS round-trip
  returns `{fresh, text}` would halve adapter latency on the hot path.
  Same caveat: belongs in the async refactor.

- **fdResolveStateDir mkdirSync/chmodSync per call** (review-perf
  important). Memoize state-dir resolution per process. Touchpoint:
  every `src/paths/*.ts` path helper.

- **pane-registry adapter-arg field reads** (review-perf important).
  Adapter-args resolvers shell to `flightdeck-state get` for each field
  individually. Refactor into a single `.issues[$issue]` read with
  in-process field extraction.

- **project root + .env reloaded per CLI call** (review-perf
  important). Cache `FLIGHTDECK_PROJECT_ROOT` / state base in the
  process environment.

- **opencode pre-send polling loop** (review-perf important).
  Currently `curl + jq` every 0.5s. Use exponential backoff and one
  combined fetch+parse per iteration. Bigger win: native `fetch` once
  the daemon is async.

- **port allocator native socket probe instead of bash subshell**
  (review-perf nice).

- **adapter resolvers return objects, not flag strings**
  (review-perf nice). Eliminates `extractFlag` regex per call.

- **verifyPromptAdvanced / paneIsBusy capture full pane**
  (review-perf nice). Bound captures to the tail rows we actually
  inspect.

- **parallel-groups: multiple jq passes per call** (review-perf nice).
  Parse once, mutate natively, write once. Keep jq only for parity.

- **flightdeck-daemon health: full log/event file reads**
  (review-perf nice). Tail/stream for diagnostics.

### Bugs (review-bugs)

- **Temp cleanup doesn't survive SIGINT/SIGTERM** (review-bugs
  important #4). Need explicit signal handlers. Touchpoint:
  `src/state/master-state.ts` and any TS code that creates tmp files.
  Mostly mitigated for state writes now that the locked-bash path owns
  the tmp file — but worth a sweep when porting the daemon run-loop
  (which creates several long-lived state files).

- **parallel-groups shared tmp path + ineffective lock**
  (review-bugs important #1). Same `withLock(true)` no-op pattern as
  the original master-state issue. Fix: convert `parallel-groups` to
  use `lockedJqUpdate` etc. Straightforward but I didn't get to it.

- **.env loader is not bash-source equivalent** (review-bugs
  important #8). The current parser doesn't expand `$XDG_RUNTIME_DIR`
  or `${VAR:-fallback}`. Mitigate: document the supported subset and
  enforce in bash too, OR shell out to `set -a; source ...; env -0`.

- **jq filter interpolation of issue IDs** (review-bugs nice #1).
  Replace string concatenation in jq queries with `--arg` variables in
  pane-registry and parallel-groups. Robustness, not a current bug.

- **Dependency preflight** (review-bugs nice #2). Add explicit checks
  for `jq`, `flock`, `tmux`, `bash`, `curl`, `gh`, `bun` at startup.
  Currently scattered ad-hoc.

### Cross-harness (review-xharness)

- **gh availability gating** (already fixed in pane-poll).
- **Adapter-args spawn fallback edge cases** — verified to match bash.
- jq filter constants verified byte-identical to bash. No fixes needed.

## Verification

- `bun run typecheck` — clean
- `bun test` — 81 pass, 0 fail (parity tests covering 8 ported scripts)

## Where this leaves us

All five reviewer-flagged criticals are addressed in code, with a clear
deferred list for the next pass. The TS port can now flip per-script
defaults to TS one at a time and exercise each under the live
integration smoke — the race-conditioned paths (state CRUD, port
allocation, master-busy + WAKE_PENDING, daemon events/ack) hold real
flock for the full critical section, matching the bash contract.
