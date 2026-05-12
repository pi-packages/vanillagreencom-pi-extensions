# Performance review — Flightdeck TS port session 2

Scope: new commits `69cda24..HEAD`; only the session-2 files requested.

## CRITICAL

- None.

## IMPORTANT

- `src/paths/daemon.ts:62`: Hot path. `fdAdapterFreshnessCacheSet` now writes freshness updates by spawning `flock -> bash -> jq -e -> jq update` at `src/paths/daemon.ts:85`. Adapter probes use this cache during pane polling; when `FD_ADAPTER_FRESHNESS_TTL` expires, multiple panes can serialize on the same cache lock and pay multiple forks per cache miss.
  Suggested fix: Keep the concurrency fix, but move cache read/modify/write to native TS under a real held lock, or batch freshness updates once per `pane-poll --batch` invocation and flush once.

- `src/bin/flightdeck-daemon.ts:41`: Turn-end CLI path. `preflightDeps()` runs before action dispatch for every `flightdeck-daemon` invocation, including `ack`/`events`; `src/shared/preflight.ts:21` then checks required tools with three separate `command -v` shell forks (`src/shared/preflight.ts:25`). The `requiredChecked` memo only helps inside one short-lived Bun process, not across repeated CLI calls.
  Suggested fix: Run mandatory preflight once in the long-lived daemon/start path, or combine checks into one PATH scan / one shell command. For `ack`/`events`, check only the tools actually needed by that action.

- `src/shared/project.ts:64`: CLI startup path. `.env` parity now forks bash to `source` and `env -0`, then rereads/splits the `.env` file at `src/shared/project.ts:75` and splits the full exported environment at `src/shared/project.ts:86`. Because most flightdeck helpers are separate processes, `envLoadedFor` does not amortize this across calls.
  Suggested fix: Fast-path simple `KEY=VALUE` files with a native parser and fall back to bash only when shell syntax is detected, or export a resolved env snapshot from the parent so child helpers skip `.env` loading.

## NICE

- `src/daemon/log.ts:28`: Future daemon tick/subscriber path. `daemonLog`/`daemonWarn` use `appendFileSync` for every log line (`src/daemon/log.ts:32` and `src/daemon/log.ts:38`); once wired into the TS run loop, frequent tick/subscriber logging will block the event loop on filesystem latency.
  Suggested fix: Use a single append stream or small buffered logger for steady-state daemon logs; keep sync append only for shutdown/crash paths.

- `src/bin/parallel-groups.ts:107`: Planning cold path. `cmdWrite` validates JSON in-process, then holds `flock` while a bash child runs two jq passes (`src/bin/parallel-groups.ts:119` and `src/bin/parallel-groups.ts:120`) before `mv` at `src/bin/parallel-groups.ts:122`. Concurrent writers now serialize correctly, but the critical section includes both jq fork costs.
  Suggested fix: Collapse next-id + append into one jq invocation under the lock, or parse/update the JSON natively inside the locked critical section.

- `src/bin/flightdeck-daemon.ts:252`: Stop/cleanup cold path. `collectDescendants` walks the process tree with one `pgrep -P` subprocess per discovered PID (`src/bin/flightdeck-daemon.ts:259`). Large subscriber trees can make `stop` O(processes) forks.
  Suggested fix: Prefer process-group termination when available, or collect descendants with one `ps`/`pgrep` snapshot and build the tree in memory.

- `src/daemon/gc.ts:46`: Startup cold path. `gcOrphanState` scans the same `readdirSync` result twice (`src/daemon/gc.ts:53` and `src/daemon/gc.ts:83`) and `readPidFile` does `existsSync` plus `readFileSync` per matching pid file (`src/daemon/gc.ts:18`). Large stale state dirs make daemon startup do extra sync I/O.
  Suggested fix: Combine the two passes over `entries`; in `readPidFile`, drop the `existsSync` precheck and just attempt the read for matching entries.

<output_format>{"file":"docs/work-in-progress/review-perf-session2.md","counts":{"critical":0,"important":3,"nice":4},"summary":"No critical regressions; session-2 adds mostly startup/freshness-cache fork and sync-I/O costs"}</output_format>
