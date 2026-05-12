# Round-2 performance audit — Flightdeck TS port

Scope: commits `7f9531b..HEAD`; prior findings: `docs/work-in-progress/review-perf-session2.md`.

## verified resolved

- `src/paths/daemon.ts:100`: Freshness cache hot-path write is now zero-fork on glibc/Bun FFI hosts. `fdAdapterFreshnessCacheSet` takes the native branch at `src/paths/daemon.ts:110`, holds `flock(2)` via `withInprocFlock` at `src/paths/daemon.ts:112`, and runs only JSON/fs work in `freshnessRMW` (`src/paths/daemon.ts:77`). `src/shared/inproc-flock.ts:23` memoizes `dlopen`, so steady-state cost is open/close plus two FFI `flock` calls (`src/shared/inproc-flock.ts:44`, `src/shared/inproc-flock.ts:46`, `src/shared/inproc-flock.ts:51`).
  Verification note: local smoke showed `inprocFlockAvailable() === true` and cache write succeeded without taking the fallback branch.

- `src/paths/daemon.ts:116`: Freshness fallback remains correctness-safe when `bun:ffi`/`libc.so.6` is unavailable: one `flock`-held bash+jq script rebuilds a valid object and writes via tmp+mv (`src/paths/daemon.ts:120`–`src/paths/daemon.ts:127`). Performance regresses to subprocess mode only on fallback platforms, not on the Linux/glibc hot path.

- `src/daemon/gc.ts:58`: `gcOrphanState` now traverses the `readdirSync` result once. The single loop handles daemon pid files at `src/daemon/gc.ts:59` and subscriber pid files at `src/daemon/gc.ts:85`, resolving the prior double-pass directory scan.

- `src/bin/parallel-groups.ts:129`: `parallel-groups write` keeps both jq operations inside one lock-held `flock ... bash -c` invocation. The `next_id` jq at `src/bin/parallel-groups.ts:122` and append jq at `src/bin/parallel-groups.ts:123` cannot interleave with another writer.

- `src/bin/flightdeck-daemon.ts:260`: `collectDescendants` no longer forks `pgrep` per process-tree level. It takes one `ps -eo pid=,ppid=` snapshot at `src/bin/flightdeck-daemon.ts:265`, builds an in-memory children map at `src/bin/flightdeck-daemon.ts:267`, then BFSes locally at `src/bin/flightdeck-daemon.ts:280`.

## still slow

- IMPORTANT — `src/bin/flightdeck-daemon.ts:47`: `ack`/`events` now choose `STATE_ONLY_REQUIRED`, but `STATE_ONLY_REQUIRED` still has `jq`, `flock`, and `bash` (`src/shared/preflight.ts:20`), and `preflightDeps` still runs one `command -v` shell fork per entry (`src/shared/preflight.ts:29`–`src/shared/preflight.ts:35`). Because each `ack` is a fresh CLI process, the `checked` set does not amortize across turns. `ack`/`events` also still call `tmux display-message` before dispatch at `src/bin/flightdeck-daemon.ts:103`.
  Suggested fix: For `ack`/`events`, check only `flock`+`bash` (no jq in `lockedEventsDrain`) and combine PATH checks into one shell/PATH scan; if `--session` is already `$N` or `sN`, derive `sessionKey` before any tmux probe.

- IMPORTANT — `src/shared/project.ts:64`: `.env` loader still forks bash for every helper process that calls it, then rereads/splits the `.env` file at `src/shared/project.ts:75` and splits the whole exported environment at `src/shared/project.ts:86`. `envLoadedFor` only helps within one short-lived Bun process, so repeated helper invocations still pay this startup cost.
  Suggested fix: Fast-path simple `KEY=VALUE` env files natively and fall back to bash only when shell syntax is detected, or have the parent export a resolved env snapshot for child helpers.

- NICE — `src/bin/parallel-groups.ts:122`: The two jq passes are correctly under one lock, but still cost two jq executions while holding the critical section (`src/bin/parallel-groups.ts:122` and `src/bin/parallel-groups.ts:123`). This is cold/planning-path, not daemon tick hot path.
  Suggested fix: Collapse next-id and append into one jq program, or parse/update the groups object natively inside the lock-held child.

- NICE — `src/daemon/log.ts:29`: Daemon logging still uses `appendFileSync` per line (`src/daemon/log.ts:42` and `src/daemon/log.ts:48`). Once wired into the TS run loop/subscribers, frequent logs will block the event loop on filesystem latency.
  Suggested fix: Use one append stream or small buffered logger for steady-state logging; reserve sync append for crash/shutdown paths.

## new finding

- IMPORTANT — `src/bin/pane-poll.ts:335`: Pi adapter reads now wrap `pi-bridge history` in `timeout(1)`. This bounds a hung bridge, but adds an extra subprocess on every Pi pane poll tick in the hot path (`timeout` plus `pi-bridge` plus jq extraction at `src/bin/pane-poll.ts:337`). Opencode uses curl's built-in timeout and codex uses its own env timeout, so this extra wrapper is Pi-specific fanout.
  Suggested fix: Use Bun async spawn with a timer/AbortSignal, or add/use a native timeout option in `pi-bridge`, so the read remains bounded without an extra process per pane.

- NICE — `src/bin/pane-poll.ts:383`: Missing-worktree terminal check now runs `bash -c 'command -v gh'` before the bounded `gh pr view` call at `src/bin/pane-poll.ts:385`. This is a rare terminal/orphan path, but when a worktree is gone and PR metadata remains, it adds a shell fork every poll until state transitions.
  Suggested fix: Resolve/cache `gh` availability once per `pane-poll --batch` process, or pass a precomputed optional-dep capability from daemon startup.

<output_format>{"file":"docs/work-in-progress/review-perf-round2.md","counts":{"critical":0,"important":3,"nice":3,"verified_resolved":5},"summary":"Freshness cache and GC fixes resolved; ack preflight and Pi timeout wrapper still add hot-path forks"}</output_format>
