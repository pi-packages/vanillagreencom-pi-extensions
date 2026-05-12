# Structure / cross-harness audit — session 2 additions

Scope reviewed:

- Commit range: `69cda24..HEAD`
- New daemon helper modules: `src/daemon/{log,gc,wake-payload}.ts`
- Shared preflight: `src/shared/preflight.ts`
- Doc-audit application from `53e1256`
- Parallel-groups race fix and regression tests

Counts: critical 0, important 2, nice 3.

## daemon-helpers

### nice

- **Category:** daemon-helpers / wake payload
- **Severity:** nice
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/daemon/wake-payload.ts:11-18`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:590-595`
- **Description:** `wakePayloadForHarness()` lowercases the harness before dispatch, but bash's `wake_payload_for_harness()` is case-sensitive. For normal registry values (`codex`, `pi`, `claude`, `opencode`) output matches, but inputs like `CODEX` or `Pi` produce codex/pi payloads in TS and the default `/flightdeck ...` payload in bash. The unit test explicitly blesses the case-insensitive behavior, so this is intentional drift rather than byte-for-byte parity.
- **Suggested fix:** Remove `.toLowerCase()` and drop the case-insensitive test, unless the TS run-loop will normalize harness values before calling this helper and docs explicitly define that normalization.

### verified

- `daemonLog()` / `daemonWarn()` match bash line shape: `<date -Iseconds-like timestamp> [tag] message\n`; `warn` mirrors bash by always writing stderr.
- `gcOrphanState()` mirrors the bash `gc_orphan_state()` file set and subscriber-pid sweep: it enumerates only explicit daemon files, preserves `.session-lock`, calls lock-aware cleanup for wake/events state, and removes dead subscriber pid files.
- These helper modules are foundation code only at HEAD; `flightdeck-daemon start` still forwards to bash, and the TS CLI surface does not yet import `daemonLog`, `gcOrphanState`, or `wakePayloadForHarness`.

## preflight

### important

- **Category:** preflight
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/shared/preflight.ts:1-10,35-41`; `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:41,96`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:195-208`
- **Description:** Preflight semantics do not match the bash daemon. Bash checks `tmux jq flock awk sha256sum` and exits `2` before session resolution. TS says `tmux` is mandatory in the comment but `REQUIRED` only contains `jq`, `flock`, and `bash`; `flightdeck-daemon.ts` immediately shells out to `tmux` after `preflightDeps()`, so a missing `tmux` degrades to misleading session/no-daemon behavior instead of the bash "missing required commands" failure. TS also exits `127` on missing deps while bash exits `2`.
- **Suggested fix:** For daemon parity, include at least `tmux` in `REQUIRED` and use the same failure class/exit code as bash (`2`). If this helper is meant to become common to all TS CLIs, either add per-command `extra` checks for `timeout`/`pgrep`/`gh`/`curl` where used or keep the comment scoped to the daemon.

## docs-punchlist

### important

- **Category:** docs-punchlist
- **Severity:** important
- **Docs:** `skills/flightdeck/README.md:62`; `skills/flightdeck/SKILL.md:210`
- **Code:** `skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:296-303,313-325,329-342`
- **Description:** The doc-audit update overstates `FD_ADAPTER_READ_TIMEOUT_SEC` behavior. README/SKILL now say a stale or wedged adapter "falls through to tmux capture". Current TS `pane-poll` sets `ocUsed`/`piUsed`/`cxUsed` as soon as fresh adapter args exist, then on timeout/non-zero read leaves `buf` empty and still skips tmux fallback because `adapterUsed` is true. Freshness-probe failure falls back; read-timeout failure does not.
- **Suggested fix:** Either change docs to say the timeout bounds adapter reads and classifies empty adapter text on read failure, or change `pane-poll` so adapter read failure leaves that harness as unused and executes the tmux capture fallback.

### nice

- **Category:** docs-punchlist
- **Severity:** nice
- **Docs:** `skills/flightdeck/workflows/watch.md:40-57`
- **Review source:** `docs/work-in-progress/review-docs.md` finding for `skills/flightdeck/workflows/watch.md` lines 3 and 40-57
- **Description:** The watch.md punchlist item asked for the daemon-start TS split near the daemon start instructions: `flightdeck-daemon start` always delegates to bash, while `status/events/ack/health/stop` may run through TS when gated. The commit added the adapter-timeout note later in §2, but §1 still describes `start` as the bash daemon without the `FLIGHTDECK_USE_TS` caveat. Other docs now carry the caveat, so this is under-reach in the requested workflow file rather than a global docs gap.
- **Suggested fix:** Add a one-sentence parenthetical after the `flightdeck-daemon start` command in `watch.md`: during the TS-port transition, `start` delegates to `flightdeck-daemon.bash` regardless of `FLIGHTDECK_USE_TS`; only the lighter daemon CLI actions use TS when gated.

- **Category:** docs-punchlist
- **Severity:** nice
- **Docs:** `skills/flightdeck/README.md:178-181`
- **Observed:** `cd skills/flightdeck/lib/flightdeck-core && bun test` reports `106 pass` across `14 files`
- **Description:** README says the Bun parity suite is "Currently 90+ tests across 11 files." That was true around the doc-audit commit, but HEAD has since added daemon-helper/preflight tests and the WIP progress doc already says 106 tests across 14 files. The operator-facing README is now stale.
- **Suggested fix:** Replace the exact count with the current value or avoid count drift by saying "the Bun parity/unit suite" without hardcoding file/test totals.

### verified

- `skills/flightdeck/SKILL.md` and `skills/flightdeck/README.md` faithfully document the trampoline model, default-bash rule, TS opt-in flags, daemon `start` exception, conditional `bun` requirement, and parity/live-test split.
- `skills/flightdeck/tests/README.md` faithfully documents Bun parity tests, live-wake TS gates, and the daemon `start` bash caveat.
- `patterns/prompt-handlers.md` removes bash-specific "grep-check" language and points maintainers to both bash and TS `pane-respond` implementations plus parity tests.
- `patterns/tmux-monitoring.md` now tells adapter authors to update both bash and TS paths, parity tests, live smoke tests, and docs.
- `workflows/start.md` faithfully updates the bun preflight caveat for TS trampolines.

## parallel-groups

### verified

- The race fix moves `write` read/next-id/append/write into a single `flock -x ... bash -c` critical section, eliminating the old parent-side no-op lock pattern.
- The new regression test spawns 10 concurrent TS writers and asserts 10 distinct returned `group_id`s. That directly covers the previously flagged duplicate-id race. A stronger test could also inspect the final `parallel-groups.json` for 10 persisted groups, but the current test is adequate for the reported race symptom because the id is emitted only after the locked write succeeds.
