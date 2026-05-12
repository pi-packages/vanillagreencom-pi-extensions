# Flightdeck TS port bug audit — session 2

Scope: commits `69cda24..HEAD`, focused only on the requested new/modified files:

- `skills/flightdeck/lib/flightdeck-core/src/daemon/{log,gc,wake-payload}.ts`
- `skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts`
- `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts`
- `skills/flightdeck/lib/flightdeck-core/src/paths/daemon.ts`
- `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts`
- `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts`

Reference material read: `docs/work-in-progress/review-bugs.md` and `docs/work-in-progress/review-triage.md`.

Positive verification:

- `parallel-groups write` now uses a real `flock -x <lock> bash -c ...` critical section (`parallel-groups.ts:116-127`). A 10-way local write stress test produced 10 unique group ids and valid JSON.
- `parallel-groups clear` uses `lockedJqUpdate` / `lockedAtomicWrite` for the mutation paths (`parallel-groups.ts:140-148`).
- `flightdeck-daemon events` / `ack` now route through `lockedEventsDrain`, so the main event drain and WAKE_PENDING clear are no longer using the session-1 no-op flock pattern (`flightdeck-daemon.ts:138-161`).

## Critical

None found in the requested session-2 scope.

## Important

1. `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:40-94` — `.env` loading still does not match bash `source` precedence.
   - Description: the loader now sources the file in a bash child, but it refuses to import any declared key that already exists in `process.env` (`project.ts:91-93`). Bash `source .env.local` overwrites inherited variables by default. It also converts a source failure into a warning and continues (`project.ts:65-67`), while the bash scripts run under `set -e` and stop on a failing `source`.
   - Repro / risk window: with `FD_STATE_DIR=preset` in the environment and `.env` containing `FD_STATE_DIR=from-env`, bash prints/uses `from-env`; the TS loader leaves `preset`. This can send daemon state, cache state, or project state to a different directory than the bash implementation when users export an env var and the project `.env.local` intentionally pins another value.
   - Suggested fix sketch: after the bash child sources the file, assign declared keys from the child environment unconditionally so `.env.local` / `.env` has the same precedence as bash. If env-overrides-project is desired, change the bash scripts too; do not leave TS and bash split. On `source` failure, exit with the bash-equivalent nonzero status instead of warning and continuing with defaults.

2. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:272-290` and `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:354` — `lockedStateCleanup` is not actually locked and still leaves wake-event state behind.
   - Description: the new helper deletes `wakePending`, `eventsFile`, `heartbeatFile`, and `EVENTS_FILE.draining.*` directly, with no `SESSION_LOCK` acquisition. The bash `locked_state_cleanup` takes the session lock before removing wake/event state. The TS helper also does not remove `fd-wake-events-${sessionKey}.log` or its `.draining.*` snapshots, despite review-triage saying wake-events cleanup was included.
   - Repro / risk window: a concurrent `ack` / `events` caller, daemon exit trap, or still-alive subscriber can race the stop cleanup and append/drain around these direct unlinks. After `flightdeck-daemon stop`, stale wake-events JSONL can remain in `FD_STATE_DIR`; a later TS run-loop port or any consumer that drains before bash-start cleanup could process old wake records.
   - Suggested fix sketch: implement cleanup with the same session lock used by `lockedEventsDrain`, and remove `WAKE_PENDING`, `EVENTS_FILE`, `WAKE_EVENTS_LOG`, heartbeat, and both `.draining.*` families while holding it. Either pass `wakeEventsLog` into the helper or add a path helper parallel to bash `oc_wake_events_log`.

3. `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:140-141` — invalid `--group` values can be transformed into a different group id and delete the wrong row.
   - Description: `cmdClear` sanitizes the supplied group id with `groupId.replace(/[^0-9-]/g, "")` and interpolates the result into the jq filter. That is injection-resistant, but it changes user input instead of validating it.
   - Repro / risk window: `parallel-groups clear --group 1abc2` deletes group `12`. The bash original used `--argjson gid "$group_id"`, which would reject malformed JSON/number input instead of mutating a different group.
   - Suggested fix sketch: validate `groupId` with `^-?[0-9]+$` before acquiring the lock; reject invalid values with exit 2. Then pass the numeric value as an arg to a locked jq helper that supports `--argjson`, or build a small flock-held bash script with `$3` as `gid`.

4. `skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts:1-10`, `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:41`, and `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:17-33` — dependency preflight is incomplete and not applied to `parallel-groups`.
   - Description: `preflight.ts` says each CLI entry calls `preflightDeps()` and says tmux/bun are mandatory, but `REQUIRED` contains only `jq`, `flock`, and `bash`, and the only call site in the requested scope is `flightdeck-daemon.ts:41`. `parallel-groups.ts` still spawns `jq` directly without a preflight.
   - Repro / risk window: with `jq` absent, `parallel-groups read/write` still fails via the first jq spawn path with the old ad-hoc status/message instead of the new clear exit-127 preflight. With `tmux` absent, `flightdeck-daemon status --session <name>` can fall through session resolution and report `no daemon` rather than failing like the bash daemon's dependency preflight.
   - Suggested fix sketch: either make preflight action-specific and call it from every CLI entry, or update the comments/tests to match a narrower contract. For daemon commands that need tmux session-name resolution, include `tmux`; for `parallel-groups`, call `preflightDeps(["jq"])` or include the common required set near startup.

## Nice

1. `skills/flightdeck/lib/flightdeck-core/src/paths/daemon.ts:62-85` — freshness cache locking was fixed, but corrupt-cache fallback still masks corruption and write failures.
   - Description: `fdAdapterFreshnessCacheSet` now takes `flock`, resolving the session-1 lost-update race. However, if the cache is not a JSON object it silently replaces it with `{}` (`daemon.ts:74-76`), and the outer `spawnSync` result is ignored (`daemon.ts:85`).
   - Repro / risk window: a truncated cache file or missing `jq`/`flock` is treated as a cache miss/reset with no operator signal. This is low-risk because the freshness cache is ephemeral, but it keeps part of the session-1 "fallback masks underlying issue" behavior.
   - Suggested fix sketch: rotate corrupt cache to `fd-adapter-freshness-cache.json.corrupt.<ts>` before reinitializing, and log or return a status when the flock/jq child fails.

2. `skills/flightdeck/lib/flightdeck-core/src/daemon/log.ts:28-41` — daemon log write failures are swallowed.
   - Description: `appendLog` catches and ignores all append failures. That makes daemon logging best-effort, but the bash logger writes to `$LOG` directly and would fail loudly under `set -e` in many call paths.
   - Repro / risk window: if `FD_STATE_DIR` is unwritable or the filesystem is full, the daemon can continue without recording `wake`, `wake-fail`, `gc`, or `stop` lines. Later `health` output may show stale or empty log state with no indication that logging itself broke.
   - Suggested fix sketch: return a boolean/error from `daemonLog` / `daemonWarn`, or at least emit a one-time stderr warning when appending to the log fails.

3. `skills/flightdeck/lib/flightdeck-core/src/paths/daemon.ts:15-32` — relative `FD_STATE_DIR` memoization does not account for cwd changes.
   - Description: the cache key includes `FD_STATE_DIR` and `XDG_RUNTIME_DIR`, which handles env changes, but not `process.cwd()`. For relative `FD_STATE_DIR`, the cached value is still relative and `mkdirSync`/`chmodSync` run only for the cwd used on the first call.
   - Repro / risk window: a long-lived future daemon process that calls `fdResolveStateDir()` with `FD_STATE_DIR=tmp`, then changes cwd and calls it again, will reuse `tmp` without creating/chmodding the new cwd's `tmp`. Current short-lived CLI paths likely do not hit this, so this is a future-proofing edge.
   - Suggested fix sketch: resolve relative `FD_STATE_DIR` to an absolute path at load time, or include `process.cwd()` in the memoization key when `FD_STATE_DIR` is relative.

## Checks performed

- Inspected `git diff --name-status 69cda24..HEAD` and all requested target files with line numbers.
- Ran a 10-way `parallel-groups write` stress test under a temp `ORCH_CACHE_DIR` — unique ids verified.
- Ran a direct `.env` overwrite comparison: TS loader kept inherited `FD_TEST_OVER=preset`; bash `source` changed it to `from-env`.
- Ran a direct `parallel-groups clear --group 1abc2` repro under a temp `ORCH_CACHE_DIR` — group `12` was deleted.
