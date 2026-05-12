# Flightdeck documentation audit — TS port

Scope: documentation audit only. Cross-referenced the listed docs against `skills/flightdeck/lib/flightdeck-core/`, current script trampolines, `docs/work-in-progress/flightdeck-ts-port.md`, and `docs/work-in-progress/review-triage.md`.

## `skills/flightdeck/SKILL.md`

### IMPORTANT — lines 102-120 (`## Scripts` table)

**Description:** The scripts table still presents a single implementation model and does not mention that several entries are now trampolines into `lib/flightdeck-core` when `FLIGHTDECK_USE_TS=1` or `FLIGHTDECK_USE_TS_<SCRIPT>=1` is set. Operators/agents cannot tell which scripts are dual-path, that default remains bash, or that `flightdeck-daemon start` still forwards to bash even under the TS gate.

**Suggested update sketch:** Add a short “Implementation status” note before or after the table: default bash; TS opt-in via global/per-script flags; TS core lives at `skills/flightdeck/lib/flightdeck-core`; daemon `start` remains bash-only while other daemon CLI actions have TS coverage.

### IMPORTANT — lines 170-184 (`## Configuration`)

**Description:** The configuration section omits the new TS-port runtime flags (`FLIGHTDECK_USE_TS`, `FLIGHTDECK_USE_TS_<SCRIPT>`) and the adapter read timeout knob (`FD_ADAPTER_READ_TIMEOUT_SEC`, default 2s). It also says daemon tuning is “not consulted during master operation,” which is misleading when TS `pane-poll` is enabled because `FD_ADAPTER_READ_TIMEOUT_SEC` directly bounds adapter reads in the master poll path.

**Suggested update sketch:** Add a small TS/daemon tuning table or cross-reference README’s daemon table; include `FD_ADAPTER_READ_TIMEOUT_SEC` and clarify which `FD_*` variables can affect `pane-poll`/daemon behavior during watch.

### NICE — lines 102-120 (`## Scripts` table)

**Description:** The table does not point maintainers to the parity-test corpus that now defines equivalence for ported scripts. Given the port is opt-in and default-flip depends on live-test green, this is useful operational context.

**Suggested update sketch:** Note that TS parity tests live under `lib/flightdeck-core/tests/parity/` and should pass before enabling any `FLIGHTDECK_USE_TS*` gate in live sessions.

## `skills/flightdeck/README.md`

### IMPORTANT — lines 49-64 (`Daemon tuning (FD_* env vars)`)

**Description:** The daemon/env table is missing `FD_ADAPTER_READ_TIMEOUT_SEC` (default 2s), introduced to cap stale adapter reads in TS `pane-poll`. This is an operator-facing knob for slow or wedged adapters and is called out in review triage as the fix for batch serial blocking.

**Suggested update sketch:** Add `FD_ADAPTER_READ_TIMEOUT_SEC` with default `2` and explain it bounds per-adapter read subprocesses/calls so a stale adapter cannot dominate a poll tick.

### IMPORTANT — lines 66-82 (`## Scripts`)

**Description:** The scripts section does not document the trampoline/TS-port status. It lists scripts as if they have one implementation and omits `lib/flightdeck-core`, `FLIGHTDECK_USE_TS`, per-script flags, default-bash behavior, parity-test requirement, and the special daemon `start` bash-forwarding caveat.

**Suggested update sketch:** Add a “TypeScript port status” subsection after the scripts table: ported scripts, flags, default remains bash until live-test green, `bun` required for TS path, daemon `start` still bash.

### IMPORTANT — line 113 (`Installation` system requirements)

**Description:** System requirements omit `bun`. That is acceptable for the default bash path, but misleading for anyone following the new TS opt-in flags; the trampoline executes `bun .../src/bin/<script>.ts` directly.

**Suggested update sketch:** Change requirements to “default bash path: …; TS opt-in path additionally requires `bun`” or add `bun` as conditional/hard dependency for TS-port testing.

### IMPORTANT — lines 131-135 (`## Tests`)

**Description:** The tests section only mentions `tests/live-wake.sh`; it omits the Bun parity suite in `lib/flightdeck-core/tests/parity/` and the current status that parity is green but live TS default-flip is still pending.

**Suggested update sketch:** Add commands: `cd skills/flightdeck/lib/flightdeck-core && bun test && bun run typecheck`; explain parity tests are necessary but not sufficient before flipping defaults.

### NICE — lines 125-129 (`Operational caveats`)

**Description:** Operator-facing caveats do not include deferred TS-port issues from `review-triage.md` that can affect opt-in users: batch polling is timeout-bounded but still sequential, TS `.env` parsing is not bash-source equivalent, and `parallel-groups` locking remains deferred.

**Suggested update sketch:** Add a short “TS opt-in caveats” bullet list or link to the WIP triage doc until the deferred issues are resolved.

## `skills/flightdeck/tests/README.md`

### IMPORTANT — lines 5-11 (`Host requirements`)

**Description:** Host requirements omit `bun`, even though TS-port validation now depends on `bun test`, `bun run typecheck`, and trampolined TS execution.

**Suggested update sketch:** Add `bun` as required for TS-port/parity tests; distinguish it from full live-wake requirements if necessary.

### IMPORTANT — lines 13-48 (`live-wake.sh` / shape mode)

**Description:** The README documents only live wake and bash syntax smoke checks. It does not document the parity test corpus in `lib/flightdeck-core/tests/parity/`, how to run it, or how to run live wake with `FLIGHTDECK_USE_TS*` gates.

**Suggested update sketch:** Add a “TS parity tests” section with `cd skills/flightdeck/lib/flightdeck-core && bun test`; add examples for `FLIGHTDECK_USE_TS_PROMPT_CLASSIFY=1 .../live-wake.sh` and global `FLIGHTDECK_USE_TS=1` with the daemon-start caveat.

### NICE — lines 19-23 (live wake assertions)

**Description:** The live-wake assertions specifically describe a “bash inner pane” and daemon fallback path, but not whether the test exercises bash vs TS script paths. This can mislead reviewers into thinking live-wake currently validates TS behavior by default.

**Suggested update sketch:** State that current default live-wake uses bash trampolines unless `FLIGHTDECK_USE_TS*` is set; identify which assertions cover the daemon start path that remains bash.

## `skills/flightdeck/patterns/prompt-handlers.md`

### NICE — line 142 (`Validation`)

**Description:** The validation text says `pane-respond` “grep-checks” for `PRESERVE:`, `APPLY:`, and `VERIFY:`. That is an implementation detail of the legacy bash body; the TS path validates the same contract without necessarily using grep.

**Suggested update sketch:** Reword to behavior: “validates that all three non-empty sections are present before sending,” avoiding bash-specific implementation detail.

### NICE — line 248 (`Why --option N is harness-aware`)

**Description:** “Add new adapters in `scripts/pane-respond`” omits the TS implementation location now that adapter behavior may need edits in `lib/flightdeck-core/src/bin/pane-respond.ts` as well as the bash sibling.

**Suggested update sketch:** Say to update both the legacy bash body and TS port/parity tests while the trampoline dual-path is active.

## `skills/flightdeck/patterns/tmux-monitoring.md`

### IMPORTANT — line 5 (`Fallback path notice`)

**Description:** The notice describes adapter freshness probes and fallback behavior but omits the new `FD_ADAPTER_READ_TIMEOUT_SEC` bound that affects stale HTTP/socket/CLI reads in the TS path. Operators debugging slow polls will not find the new knob here.

**Suggested update sketch:** Add a sentence that TS `pane-poll` bounds adapter reads with `FD_ADAPTER_READ_TIMEOUT_SEC` (default 2s), separate from `FD_ADAPTER_FRESHNESS_TTL` caching.

### IMPORTANT — lines 145-149 (`To add an adapter for a new harness`)

**Description:** The adapter-extension instructions still say to add functions in the relevant script and register dispatch cases, but they do not mention the dual implementation model (`scripts/*.bash` plus `lib/flightdeck-core/src/...`) or parity tests. A maintainer could update only bash and leave the TS opt-in path divergent.

**Suggested update sketch:** Require updating the bash body, TS source under `lib/flightdeck-core/src`, trampoline flag coverage if needed, README/SKILL tables, and parity/live tests.

## `skills/flightdeck/workflows/start.md`

### IMPORTANT — lines 15-17 (`FLIGHTDECK_PREFLIGHT` dashboard)

**Description:** The bun preflight text says bun is currently used by Claude-channel and codex-bridge transports and that missing bun only degrades channel transports. With the TS port, bun is also the runtime for any trampolined TS script selected by `FLIGHTDECK_USE_TS*`; missing bun will fail the TS path rather than merely falling back to tmux keystrokes.

**Suggested update sketch:** Clarify: bun is optional for default bash operation/channels may fall back, but required for TS-port flags and parity testing.

## `skills/flightdeck/workflows/watch.md`

### NICE — line 3 and lines 40-57 (`flightdeck-daemon` start)

**Description:** The workflow correctly describes the running poller as a bash daemon today, but it does not call out the subtle TS-port split: `flightdeck-daemon start` forwards to bash even when `FLIGHTDECK_USE_TS=1`, while other daemon CLI actions can run through the TS trampoline. This is easy to misinterpret during live TS testing.

**Suggested update sketch:** Add a parenthetical near the daemon start instructions: “During the TS-port transition, `start` always delegates to `flightdeck-daemon.bash`; `status/events/ack/health/stop` may be TS when gated.”

### NICE — lines 83-90 (`pane-poll --batch`) 

**Description:** The batch poll section does not mention `FD_ADAPTER_READ_TIMEOUT_SEC`, which is relevant when TS `pane-poll` is enabled because adapter calls are timeout-capped but still processed sequentially (per deferred triage).

**Suggested update sketch:** Add a debugging note pointing to README/tmux-monitoring for adapter timeout tuning and current sequential batching caveat.

## `pi-extensions/pi-flightdeck/README.md`

### NICE — lines 51-52 (`Daemon tuning env vars remain owned by the flightdeck skill/daemon`)

**Description:** The README highlights `FD_OC_BACKOFF_MAX_SEC` as a notable operator knob but omits `FD_ADAPTER_READ_TIMEOUT_SEC`, which is now another relevant operator knob for stale adapter reads when TS `pane-poll` is enabled.

**Suggested update sketch:** Add a brief mention/link: adapter read timeouts are controlled by `FD_ADAPTER_READ_TIMEOUT_SEC` in the flightdeck skill docs; the extension only observes resulting state/logs.

### NICE — line 62 (`How it reads state`)

**Description:** The state-path section says paths mirror `scripts/lib/daemon-paths.sh` and `flightdeck-state` only. With the TS port, equivalent path logic also exists under `lib/flightdeck-core/src/paths/daemon.ts`; future dashboard maintainers need to keep both in mind while dual-path parity exists.

**Suggested update sketch:** Say paths mirror the flightdeck path helpers (`scripts/lib/daemon-paths.sh` and the TS `lib/flightdeck-core/src/paths/daemon.ts` parity port) plus `flightdeck-state`.

## `.claude/CLAUDE.md`

### NICE — whole file / project guidance

**Description:** The project-level Claude guidance does not mention the active flightdeck TypeScript port worktree or the dual-path/trampoline rule. It contains general “docs ship with code changes” guidance, but no local note warning Claude agents not to flip defaults, delete `.bash` siblings, or edit generated artifacts when reviewing/continuing this branch.

**Suggested update sketch:** Add a temporary worktree note or link to `docs/work-in-progress/flightdeck-ts-port.md`: default remains bash, TS is opt-in via flags, daemon `start` is bash, run Bun parity tests before live testing, do not flip defaults until live-test green.

## Files audited with no findings

- `skills/flightdeck/patterns/README.md`
- `skills/flightdeck/patterns/claude-channels.md`
- `skills/flightdeck/patterns/conflict-detection.md`
- `skills/flightdeck/patterns/decision-biases.md`
- `skills/flightdeck/patterns/opencode-questions.md`
- `skills/flightdeck/patterns/pi-questions.md`
- `skills/flightdeck/workflows/close-issue.md`
- `skills/flightdeck/workflows/handle-prompt.md`
- `skills/flightdeck/workflows/merge-plan.md`
- `skills/flightdeck/workflows/parallel-check.md`
- `skills/flightdeck/workflows/start-new.md`
- `skills/flightdeck/workflows/terminate.md`
