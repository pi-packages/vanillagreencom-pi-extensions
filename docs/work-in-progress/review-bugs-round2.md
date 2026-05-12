# Flightdeck TS port bug audit — round 2

Scope: commits `7f9531b..HEAD` (`059c43b`, `bfedf33`, `53d3061`, `81dfc71`, `7c5d3d3`, `f37a919`, `9eb0d5c`). Focus was the round-1 bug report (`review-bugs-session2.md`) and dispatch (`REVIEW-ROUND-1.md`).

Checks performed:

- Read changed files with line numbers: `src/shared/project.ts`, `src/shared/preflight.ts`, `src/shared/inproc-flock.ts`, `src/paths/daemon.ts`, `src/state/locking.ts`, `src/bin/{flightdeck-daemon,parallel-groups,pane-poll}.ts`, `src/daemon/{gc,log}.ts`, and related tests.
- Ran targeted tests: `bun test tests/unit/dotenv.test.ts tests/parity/parallel-groups.test.ts tests/unit/preflight.test.ts tests/unit/freshness-cache.test.ts tests/unit/gc.test.ts tests/unit/log.test.ts` — 30 pass, 0 fail.
- Ran a direct `.env` source-failure repro against TS vs bash.
- Ran direct `parallel-groups clear --group 1abc2` repro — TS exits 2 and does not mutate.
- Ran an actual 50-process freshness-cache write smoke — all 50 keys preserved.

## Verified fixed

1. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:89-102`; `tests/unit/dotenv.test.ts:89-99`
   - Description: inherited env var precedence is fixed for declared keys. The loader now unconditionally assigns declared keys from the bash-sourced child environment, so `.env` / `.env.local` overwrites `process.env`, matching bash `source`. The new test covers the exact `FD_TEST_OVER=preset` / `.env FD_TEST_OVER=from-env` regression and cross-checks bash.
   - Fix sketch: no further fix for overwrite precedence. Source-failure parity is still broken separately below.

2. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:290-304`; `skills/flightdeck/lib/flightdeck-core/src/state/locking.ts:256-290`
   - Description: `lockedStateCleanup` now delegates to `lockedCleanupState`, and the cleanup script runs under `flock` for the duration of the work. It covers all requested families: `wakePending`, `eventsFile`, `heartbeatFile`, `wakeEventsLog`, plus `.draining.*` snapshots for both events and wake-events logs.
   - Fix sketch: no product-code fix needed. A direct unit test for `lockedCleanupState` would still be useful, but no test was promised for this item.

3. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:143-160`; `tests/parity/parallel-groups.test.ts:161-180`
   - Description: `clear --group` now validates with `/^-?\d+$/`, exits 2 for invalid input, and uses `jq --argjson gid` inside a flock-held bash child. The regression no longer deletes group `12` when passed `1abc2`; direct repro confirmed exit 2 and no mutation.
   - Fix sketch: product code is fixed. The test proves non-mutation but does not assert the exact TS exit code 2; see new finding below.

4. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts:16-20,29-43`; `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:42-48`; `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:11-13`; `tests/unit/preflight.test.ts:37-53`
   - Description: preflight now includes `tmux`, `awk`, and `sha256sum` in `FULL_REQUIRED`, exits 2 on missing deps, and has action-specific sets. Daemon `ack`/`events` use `STATE_ONLY_REQUIRED`; other daemon actions use `FULL_REQUIRED`; `parallel-groups` also preflights state deps.
   - Fix sketch: no fix needed for the round-1 item.

5. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:291-362`
   - Description: adapter `*Used` flags now stay false unless the adapter read succeeds and extracts non-empty text. On timeout, non-zero status, empty stdout, or empty extraction, `adapterUsed` remains false and the tmux capture fallback runs at `pane-poll.ts:364-372`.
   - Fix sketch: code fix is correct. The promised regression test is missing; see new finding below.

6. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/paths/daemon.ts:70-128`; `skills/flightdeck/lib/flightdeck-core/src/shared/inproc-flock.ts:39-56`; `tests/unit/freshness-cache.test.ts:43-53`
   - Description: freshness cache writes now use native in-process `flock(2)` when available, release locks in `finally`, and fall back to subprocess `flock(1)` when `dlopen("libc.so.6")` fails. Corrupt JSON is rotated on the native path before a fresh cache is written. A direct 50-process smoke preserved all keys.
   - Fix sketch: no product-code race found in the native path. Test concurrency coverage is flawed; see new finding below.

7. Severity: verified fixed — `skills/flightdeck/lib/flightdeck-core/src/daemon/gc.ts:52-91`; `skills/flightdeck/lib/flightdeck-core/src/daemon/log.ts:28-39`; `tests/unit/gc.test.ts:27-101`; `tests/unit/log.test.ts:34-39`
   - Description: GC now scans the directory in one pass and still preserves `.session-lock` files. Daemon logging now emits a one-time stderr warning when append fails instead of silently swallowing every failure.
   - Fix sketch: no fix needed.

## Still broken

1. Severity: important — `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:53-70`; `tests/unit/dotenv.test.ts:44-142`
   - Description: `.env` source-failure parity is still wrong. The bash child script uses `set -a` but not `set -e`, so a failing command inside `.env` does not abort the source step. Bash originals run under `set -euo pipefail`; `source .env` exits immediately on a bare `false`, but TS continues, imports later assignments, and exits 0. The new tests cover overwrite precedence but do not cover source failure.
   - Repro / risk: `.env` containing `false\nFD_AFTER=after\n` makes `loadDotEnvIntoProcess` survive and set `FD_AFTER=after`; `(set -e; source .env)` exits 1 before `FD_AFTER`. A broken project `.env` can silently route TS state with partial/default env while bash fails loud.
   - Fix sketch: add `set -e` (or `set -euo pipefail` if compatible with project env files) to the bash loader script before `source "$1"`. Add a test that runs the loader in a child process against `.env` containing `false` and asserts nonzero exit, matching bash.

## New finding

1. Severity: nice — `skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:303-362`; `skills/flightdeck/lib/flightdeck-core/tests/parity/pane-poll.test.ts:28-61`
   - Description: the pane-poll adapter fallback fix has no regression test. `pane-poll.test.ts` still only covers dead panes, empty batch, and non-array input; it never creates a live pane with stale adapter metadata to prove the `*Used` flag remains false and tmux fallback runs.
   - Repro / risk: a future refactor could reintroduce the exact round-1 bug (adapter args present, read fails, empty buffer classified as idle) without test failure.
   - Fix sketch: add the promised test with a live/static tmux pane and fake adapter metadata. Force curl/bridge failure with a short `FD_ADAPTER_READ_TIMEOUT_SEC`, then assert output reflects captured pane content rather than `idle` from an empty adapter buffer.

2. Severity: nice — `skills/flightdeck/lib/flightdeck-core/tests/parity/parallel-groups.test.ts:172-177`
   - Description: the `clear --group 1abc2` regression test does not assert the promised exact TS exit code 2. It only checks both bash and TS are nonzero. Product code exits 2 correctly, but the test would pass if TS regressed to exit 1 or 127.
   - Repro / risk: change TS validation to any nonzero exit and the test still passes. This weakens the round-1 requirement that invalid `--group` should be usage-error exit 2.
   - Fix sketch: assert `b.status === 2` for the TS path while keeping bash parity as `not.toBe(0)` if bash's jq parse status differs by platform.

3. Severity: nice — `skills/flightdeck/lib/flightdeck-core/tests/unit/freshness-cache.test.ts:55-73`
   - Description: the freshness-cache "10 concurrent writers" test is effectively serial. It wraps `spawnSync` in Promise constructors; each child finishes before the next Promise is created, so it does not stress interprocess lock contention. Product code survived a separate 50-process background smoke, but the checked-in test would not catch lost-update races.
   - Repro / risk: replace the in-process lock with an unlocked read-modify-write and this test can still pass because writers run one at a time.
   - Fix sketch: use `child_process.spawn` (async) or shell backgrounding to launch all children before awaiting completion, then assert all keys exist.

4. Severity: nice — `skills/flightdeck/lib/flightdeck-core/src/shared/inproc-flock.ts:10,22-32`; `skills/flightdeck/lib/flightdeck-core/src/paths/daemon.ts:106-115`
   - Description: fallback works when `dlopen("libc.so.6")` fails, but not if the `bun:ffi` module itself is unavailable: the top-level static import at `inproc-flock.ts:10` would fail module loading before `inprocFlockAvailable()` can return false and before `paths/daemon.ts` can use subprocess `flock(1)`. This is likely fine on supported Bun builds, but it does not fully satisfy "fallback when bun:ffi unavailable".
   - Repro / risk: on a Bun build/platform where `bun:ffi` is disabled or missing, importing `paths/daemon.ts` fails even though the subprocess fallback path could work.
   - Fix sketch: use dynamic import guarded inside `syms()` or split the FFI path behind a module that is only imported after detecting `Bun` FFI support. If Bun guarantees `bun:ffi` is always present for supported platforms, document that the fallback only covers libc dlopen failure.
