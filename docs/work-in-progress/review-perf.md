# Performance review — Flightdeck TypeScript port

## CRITICAL

- `src/bin/pane-poll.ts:287`: Hot path. `pane-poll --batch` processes panes serially and each adapter/fallback read is synchronous (`curl --max-time 5`, `pi-bridge history`, `codex-bridge`, `tmux capture-pane`, and the `gh pr view` terminal check at `src/bin/pane-poll.ts:347`). One stale adapter can block the entire batch and push every pane past the `FD_POLL_SEC=2` tick budget.
  Suggested fix: Make batch mode async with bounded concurrency and per-row deadlines; preserve output order after `Promise.allSettled`. Treat stale adapter reads as per-row fallback rather than whole-cycle stalls.

## IMPORTANT

- `src/bin/pane-poll.ts:70`: Hot path. Adapter text extraction shells out to `jq` for every pane via `jqOut`/`jqFileOut`, then calls those helpers at `src/bin/pane-poll.ts:294`, `src/bin/pane-poll.ts:302`, `src/bin/pane-poll.ts:315`, and `src/bin/pane-poll.ts:326`. At ~3ms per fork, this adds direct per-pane latency every poll tick.
  Suggested fix: Replace jq filters with native TS extractors for OC/CC/PI/CX JSON. For Claude JSONL, scan from the end or keep an offset so each tick does not parse the full transcript.

- `src/paths/oc.ts:122`: Hot path. Freshness checks duplicate adapter reads: `ocAdapterIsFresh` performs `curl /session/<id>/message` at `src/paths/oc.ts:134`, and `pane-poll` repeats the same read at `src/bin/pane-poll.ts:293`. CC/PI/CX have the same probe-then-read shape at `src/paths/cc.ts:120`, `src/paths/pi.ts:93`, and `src/paths/codex.ts:145`.
  Suggested fix: Fold freshness into the actual read path: one adapter call returns `{fresh, text}` and updates the cache. Deduplicate probes per `{url, session/thread/socket}` across the whole batch.

- `src/paths/daemon.ts:33`: Hot path. Freshness cache file helpers resolve the state dir and read/parse/write the same JSON cache per adapter check; `fdResolveStateDir` itself does `mkdirSync` and `chmodSync` each call at `src/paths/daemon.ts:8`. Path helper lambdas call it repeatedly (`src/paths/oc.ts:13`, `src/paths/cc.ts:14`, `src/paths/pi.ts:12`, `src/paths/codex.ts:15`).
  Suggested fix: Resolve `stateDir` once per process and memoize the freshness cache for a `pane-poll --batch` invocation. Flush changed cache entries once at the end.

- `src/bin/pane-registry.ts:28`: Watch-cycle path. Registry operations wrap `flightdeck-state` in a subprocess; `list` shells through `flightdeck-state get` at `src/bin/pane-registry.ts:234`, and adapter-arg helpers read fields one-by-one at `src/bin/pane-registry.ts:332`, `src/bin/pane-registry.ts:341`, `src/bin/pane-registry.ts:350`, and `src/bin/pane-registry.ts:359`. Each wrapper cascades into git/jq work in `flightdeck-state`.
  Suggested fix: Move registry/state operations into a native library that loads the state JSON once per command. For adapter args, read the whole issue object once and derive all fields in process.

- `src/shared/project.ts:8`: Watch-cycle path. Every `flightdeck-state` invocation resolves the project with two `git rev-parse` subprocesses (`src/shared/project.ts:9` and `src/shared/project.ts:15`) and reloads `.env` via `resolveStateBase` at `src/state/master-state.ts:21`. Through `pane-registry` wrappers this repeats during polling and state updates.
  Suggested fix: Pass an already-resolved state path/session into registry/state commands, or cache `FLIGHTDECK_PROJECT_ROOT`/state base in the parent environment so hot-cycle commands avoid git and dotenv work.

- `src/bin/pane-respond.ts:240`: Response path. `opencodeRunAttach` polls message count with `curl` plus a `jq` fork every 0.5s until timeout (`src/bin/pane-respond.ts:241` and `src/bin/pane-respond.ts:243`), so one send can create dozens of subprocesses and block the master turn.
  Suggested fix: Use native `fetch` + JSON parsing and a cheaper completion signal from the attach process if available. If polling remains, use exponential backoff and a single parsed response per iteration.

## NICE-TO-HAVE

- `src/paths/oc.ts:25`: Cold start path. Port allocation scans can fork `bash` once per candidate port (`src/paths/oc.ts:37`, `src/paths/cc.ts:53`, `src/paths/codex.ts:54`); OC also starts a native socket probe but ignores it. A full range scan can become 10–100 shell forks.
  Suggested fix: Batch with one `ss`/`lsof` pass or use async native socket probes over the whole range. Remove the unused OC socket attempt if keeping the shell probe.

- `src/bin/pane-poll.ts:223`: Hot path micro-cost. Adapter resolvers build string flags and `extractFlag` recompiles a regex for each lookup, then reparses the string at `src/bin/pane-poll.ts:291`, `src/bin/pane-poll.ts:301`, `src/bin/pane-poll.ts:309`, and `src/bin/pane-poll.ts:323`.
  Suggested fix: Return structured objects such as `{url, session}` / `{pid, socket}` from resolver functions. Avoid string concatenation plus regex parsing on every pane.

- `src/bin/pane-poll.ts:357`: Hot path micro-cost. The fallback sentinel regex is created inside `pollOne` for every fallback pane, then reused for the current buffer and possible sibling captures.
  Suggested fix: Hoist the sentinel regex to a module-level constant alongside `CAPTURE_ARGS`.

- `src/bin/pane-respond.ts:218`: Response path. `verifyPromptAdvanced` captures the full pane and then `split/slice/join`s every 0.5s for up to 8s (`src/bin/pane-respond.ts:221` and `src/bin/pane-respond.ts:222`); `paneIsBusy` does the same shape at `src/bin/pane-respond.ts:212` and `src/bin/pane-respond.ts:214`.
  Suggested fix: Capture only the needed tail (`-S -12` or smaller) and run regex directly on the string. Avoid rebuilding line arrays in polling loops.

- `src/bin/parallel-groups.ts:113`: Cold path. `write` performs multiple jq passes over the same JSON (`nextGroupId` at `src/bin/parallel-groups.ts:101`, then updates at `src/bin/parallel-groups.ts:119` and `src/bin/parallel-groups.ts:120`); `needs-refresh` repeats similar jq work at `src/bin/parallel-groups.ts:163` and `src/bin/parallel-groups.ts:174`.
  Suggested fix: Parse `parallel-groups.json` once, update the object natively, and write once. Keep jq only for compatibility tests if needed.

- `src/bin/flightdeck-daemon.ts:250`: Diagnostic path. `health` reads the full daemon log to find the last line and reads the full events file to count queued events (`src/bin/flightdeck-daemon.ts:253` and `src/bin/flightdeck-daemon.ts:277`). Long sessions make diagnostics scale with log/event size.
  Suggested fix: Tail the last log chunk instead of reading the whole file, and maintain/update an events counter or count lines while streaming.

<output_format>{"file":"docs/work-in-progress/review-perf.md","counts":{"critical":1,"important":6,"nice":6},"summary":"pane-poll hot path is dominated by serial sync subprocesses plus per-pane jq/freshness work"}</output_format>
