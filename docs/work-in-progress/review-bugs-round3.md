# Flightdeck TS port bug audit — round 3

Scope: commits `2c9fe23..HEAD` (`69100d3`, `f47dd0d`, `f3e8219`, `dd82de1`). Focus: verify the five round-2 important items from `docs/work-in-progress/REVIEW-ROUND-2.md` and scan for regressions introduced by these four commits.

Validation performed:

- Read current changed files with line numbers: `src/shared/project.ts`, `src/shared/preflight.ts`, `src/shared/inproc-flock.ts`, `src/bin/flightdeck-daemon.ts`, `src/state/locking.ts`, `src/bin/pane-poll.ts`, and affected tests.
- Ran targeted tests: `bun test tests/unit/dotenv.test.ts tests/parity/flightdeck-daemon.test.ts tests/parity/pane-poll.test.ts tests/parity/parallel-groups.test.ts tests/unit/freshness-cache.test.ts` — 39 pass, 0 fail.
- Ran direct `.env` repros for bare `false`, native overwrite precedence, inline comments, semicolon assignments, and unset-var refs under bash `set -eu`.
- Ran direct no-`tmux` preflight checks for `ack --session s999999`, `ack --session $999999`, and `ack --session name-form`.
- Ran direct fake hung `pi-bridge` check: `spawnSync(..., { timeout })` sent SIGTERM at the deadline and `pane-poll` fell through to tmux capture.
- Ran direct fake hung `pi-bridge` with `FD_ADAPTER_READ_TIMEOUT_SEC=0.2` to compare fractional timeout behavior.

## Verified

1. Severity: verified — `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:111-140`; `tests/unit/dotenv.test.ts:101-124,169-182`
   - Item: `.env` bare source failure parity.
   - Justification: `.env` with `false\nFD_AFTER=after\n` now routes to the bash subprocess because `false` is not `KEY=VALUE`; the loader runs `set -ea`, exits 2, and leaves `FD_AFTER` unset. Bash under `set -e` exits nonzero and also leaves `FD_AFTER` unset. Direct repro confirmed both sides fail before `FD_AFTER`.
   - Caveat: broader source-failure parity is still incomplete for `set -u`; see still-broken #1.

2. Severity: verified — `skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts:18-22`; `skills/flightdeck/lib/flightdeck-core/src/state/locking.ts:77-99`; `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:51-65`; `tests/parity/flightdeck-daemon.test.ts:122-140`
   - Item: `ack`/`events` preflight trim and session-id gate.
   - Justification: `STATE_ONLY_REQUIRED` is now `['flock', 'bash']`; `lockedEventsDrain` uses only shell `mv`, `cat`, `rm`, `kill`, and optional wake-pending removal under `flock`, not `jq`. Direct no-`tmux` checks: `ack --session s999999` and `ack --session $999999` exited 0, while `ack --session name-form` exited 2 with `tmux` missing.
   - Fix sketch: no fix needed.

3. Severity: verified — `skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:336-354`
   - Item: Pi adapter timeout via `spawnSync` option.
   - Justification: a fake `pi-bridge history` process that traps SIGTERM received SIGTERM after the configured 1s deadline. `pane-poll` exited 0, kept `piUsed` false because the read timed out, and fell through to tmux capture with a non-empty capture hash. This matches the old `timeout(1)` wrapper's default TERM-after-deadline behavior for integer-second timeouts.
   - Caveat: fractional timeout behavior regressed; see new finding #1.

4. Severity: verified — `skills/flightdeck/lib/flightdeck-core/src/shared/inproc-flock.ts:15-40,68-70`
   - Item: dynamic `bun:ffi` require avoids module-load crash.
   - Justification: the static `import { dlopen, FFIType } from 'bun:ffi'` is gone. `require('bun:ffi')` happens inside `syms()` and is caught; `inprocFlockAvailable()` returns false on require/dlopen failure instead of crashing module load. Direct import under current Bun loaded the module successfully.
   - Fix sketch: no fix needed for the static-import failure path.

5. Severity: verified — `skills/flightdeck/lib/flightdeck-core/tests/parity/pane-poll.test.ts:71-131`; `tests/unit/freshness-cache.test.ts:55-75`; `tests/parity/parallel-groups.test.ts:161-180`
   - Item: regression test strengthening.
   - Justification: pane-poll fallback test primes fresh OpenCode adapter metadata, passes explicit batch adapter args, points the read at an unreachable URL, then asserts the tmux fallback produced a non-empty capture hash. Freshness cache now uses async `spawn` so writers contend. `parallel-groups clear --group 1abc2` now asserts TS exit 2 and no mutation.
   - Fix sketch: no fix needed.

## Still broken

1. Severity: important — `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:122-140`; `skills/flightdeck/scripts/flightdeck-state.bash:27,41-47`; `skills/flightdeck/scripts/parallel-groups.bash:16,22-25`
   - Item: `.env` source-failure parity is still incomplete for unset variable errors.
   - Justification: bash callers source `.env` under `set -euo pipefail` (or inherit `set -u` from their script). The TS loader uses `set -ea` only. Direct repro with `.env` containing `FD_UNSET=$NO_SUCH_ENV`: TS exits 0 and sets `FD_UNSET` to an empty string, while bash under `set -eu` exits nonzero with `unbound variable`.
   - Risk: a typo in `FD_STATE_DIR=$MISPELLED_VAR` or similar config silently falls back to an empty/default value in TS while bash fails loud. That can split state directories or mask bad configuration.
   - Fix sketch: source with `set -eua` and `set -o pipefail` to match the bash scripts, then add a child-process regression test for an unbound variable reference. If project `.env` compatibility intentionally permits unset vars, document the deliberate divergence and stop claiming `set -euo pipefail` parity in comments.

2. Severity: important — `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:41-80,144-153`
   - Item: `.env` native fast-path / shell-feature handling is not bash-equivalent.
   - Justification: the native parser accepts lines that bash parses differently, and the bash fallback's declared-key filter misses assignments after semicolons. Direct repros:
     - `.env` `FD_COMMENT=foo # comment`: TS native sets `FD_COMMENT='foo # comment'`; bash sets `FD_COMMENT='foo'`.
     - `.env` `FD_A=one; FD_B=two`: heuristic routes to bash, but declared-key scanning imports only `FD_A`; bash sets both `FD_A=one` and `FD_B=two`.
     - Similar risk exists for `export FD_A=1 FD_B=2` and escaped quotes, because the fast path treats the whole tail as one value instead of applying bash assignment grammar.
   - Risk: common inline comments can corrupt path-like settings (`FD_STATE_DIR=/tmp/fd # local` becomes a literal path containing the comment). Semicolon / multi-export env files silently drop variables that bash would set.
   - Fix sketch: make the fast-path stricter: route any `#` after a value, backslash escape, whitespace-delimited extra assignment, or semicolon line to a safer bash path. For bash fallback imports, either parse assigned variable names with bash itself (for example emit `compgen -v` before/after and diff with an allowlist prefix) or reject compound same-line assignments as unsupported instead of silently dropping later keys.

## New finding

1. Severity: nice — `skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:349-350,402-403`
   - Description: fractional `FD_ADAPTER_READ_TIMEOUT_SEC` values no longer match the old `timeout(1)` behavior for Pi bridge / `gh` calls. The new code uses `Number.parseInt(adapterTimeout, 10)` and `Math.max(1, ...)`, so `0.2` becomes `1` second. The old wrapper `timeout 0.2s ...` honored sub-second values, and `curl --max-time 0.2` still does.
   - Repro / risk: direct fake hung `pi-bridge` with `FD_ADAPTER_READ_TIMEOUT_SEC=0.2` took about 1036ms before SIGTERM, not ~200ms. Users tuning aggressive sub-second ticks get a slower Pi/gh path than OpenCode/curl and previous wrapper behavior.
   - Fix sketch: parse with `Number.parseFloat`, validate finite positive values, and compute `Math.ceil(seconds * 1000)` without forcing a 1s minimum unless docs explicitly require integer seconds.
