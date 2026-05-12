# Round-2 structure audit — flightdeck TS port

Scope reviewed:

- Commit range: `7f9531b..HEAD`
- Round-1 findings: `docs/work-in-progress/review-structure-session2.md`
- Focus commits: `81dfc71`, `7c5d3d3`, `bfedf33`, `9eb0d5c`, plus `src/shared/inproc-flock.ts`

Counts: critical 0, important 1, nice 1, verified 4.

## preflight

### important

- **Category:** preflight / action-level parity
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:42-48`; `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:102-114`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:195-208`
- **Description:** `FULL_REQUIRED` now contains all tools from bash's `_check_deps_inline` and exits with code 2, but `flightdeck-daemon.ts` does not use it for `ack` / `events`. Those actions run `preflightDeps(STATE_ONLY_REQUIRED)` before session resolution, then still call `tmux display-message` inside `resolveSessionId()` for normal session-name inputs. Bash always checks `tmux jq flock awk sha256sum` before resolution; with missing `tmux`, bash fails loud with exit 2, while TS `ack/events --session <name>` can resolve an empty session key and return without draining.
- **Suggested fix:** Use `FULL_REQUIRED` until after session resolution, or make the state-only path require an already-keyed input (`$<id>`/`s<id>`) and fail with exit 2 when `tmux` is unavailable for a session-name input. Add a regression test with `PATH` missing `tmux` for `events --session <name>`.

### verified

- `FULL_REQUIRED` includes the bash daemon's required tools: `tmux`, `jq`, `flock`, `awk`, and `sha256sum` (`skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts:16`; bash at `skills/flightdeck/scripts/flightdeck-daemon.bash:200`). It also includes `bash`, which TS lock helpers and trampolines need.
- Missing dependency exit code is now `2` (`skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts:36-42`), matching bash (`skills/flightdeck/scripts/flightdeck-daemon.bash:203-205`).

## pane-poll docs-vs-code

### verified

- `pane-poll` code now matches the updated README behavior. It only sets `ocUsed`/`ccUsed`/`piUsed`/`cxUsed` after a successful adapter read and non-empty extracted assistant text; otherwise `adapterUsed` remains false and the tmux `capture-pane` fallback runs in the same tick (`skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:295-365`).
- README now explicitly says `FD_ADAPTER_READ_TIMEOUT_SEC` read timeout / empty body clears the per-harness `*_used` flag and falls through to tmux capture, and also calls out the deliberate divergence from the bash sibling (`skills/flightdeck/README.md:62`). This resolves the round-1 docs overstatement.

## locked-cleanup

### nice

- **Category:** locked cleanup parity
- **Severity:** nice
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/state/locking.ts:256-290`; `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:290-304`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:811-837`
- **Description:** `lockedCleanupState()` now runs under the session lock and includes `WAKE_PENDING`, `EVENTS_FILE`, `WAKE_EVENTS_LOG`, and both `.draining.*` families, matching the important concurrency/file-family parts of bash `locked_state_cleanup`. However, the TS `cmdStop()` passes `heartbeatFile`, so `lockedCleanupState()` removes `fd-daemon-<key>.heartbeat` under the session lock; bash `locked_state_cleanup()` does not remove heartbeat in the stop/exit cleanup path. Bash only removes heartbeat in orphan-GC direct cleanup (`gc_orphan_state` / `locked_cleanup_for_key` path).
- **Suggested fix:** If exact `locked_state_cleanup` parity is the goal, do not pass `heartbeatFile` from `cmdStop()`; reserve heartbeat removal for GC cleanup. If the broader cleanup is intentional, document it as an intentional superset rather than "same file set" parity.

## inproc-flock

### verified

- `src/shared/inproc-flock.ts` is structurally acceptable in `shared/`: it is a generic OS-level locking primitive used by `paths/daemon.ts` freshness-cache R-M-W, not daemon-domain logic and not a state-file path resolver. Keeping it out of `paths/` and `state/locking.ts` avoids coupling all lock helpers to Bun FFI.
- Public API is narrow and clean: `withInprocFlock<T>(lockPath, fn)` for scoped exclusive locks, plus `inprocFlockAvailable()` so callers can choose a portable fallback. `paths/daemon.ts` does that fallback (`inprocFlockAvailable()` then `withInprocFlock`, else `flock(1)` child path), so the Linux-only `libc.so.6` FFI is contained.

## watch.md daemon-start caveat

### verified

- The round-1 punchlist item is now present in the correct place. `watch.md` §1 step 5 states that during the TS-port transition `flightdeck-daemon start` delegates to `flightdeck-daemon.bash` regardless of `FLIGHTDECK_USE_TS`, while lighter daemon CLI actions use TS when gated (`skills/flightdeck/workflows/watch.md:40`).
