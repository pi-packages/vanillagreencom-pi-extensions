# Daemon run-loop structure audit

Scope: `src/daemon/subscribers/spawn.ts`, `scripts/lib/subscribers.bash`, canonical subscriber bodies in `scripts/flightdeck-daemon.bash`, `src/daemon/wake.ts`, `src/bin/flightdeck-daemon.ts`, and `skills/flightdeck/tests/live-wake.sh`.

Counts: critical 0, important 0, nice 1.

## Findings

### Nice

1. **Stale TS daemon header comment says `start` is still forwarded to bash.**
   - `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:17-28` still documents `start` as unported / forwarded to the bash sibling.
   - Actual behavior contradicts that: `USE_TS_START` is set at `:119`, and gated `start` imports `../daemon/start.ts` at `:154-156`; bash fallback only happens after the gated block at `:225-226`.
   - Fix: update the header comment so future reviewers do not mistake `live-wake.sh --use-ts` for a bash-daemon smoke.

## Verified parity points

- **Subscriber bodies match canonical bash for scoped behavior.** A normalized functional diff of the four body functions found no non-comment differences. Canonical ranges: `oc_subscriber_loop` `scripts/flightdeck-daemon.bash:1006-1160`, `cc_subscriber_loop` `:1169-1229`, `pi_subscriber_loop` `:1263-1401`, `cx_subscriber_loop` `:1449-1501`. Extracted shared file ranges: `scripts/lib/subscribers.bash:62-189`, `:191-244`, `:246-378`, `:380-428`.
  - HTTP timeout parity: opencode question/message polls keep `curl -s --max-time 5` in canonical `:1052`/`:1083` and shared `:86`/`:117`.
  - Wake payload shape parity: opencode question/assistant events match canonical `:1066-1076`/`:1105-1114` and shared `:100-110`/`:134-143`; Claude assistant matches `:1216-1225` and shared `:231-240`; Pi question/subagent/assistant matches `:1318-1328`/`:1351-1360`/`:1388-1397` and shared `:295-305`/`:328-337`/`:365-374`; Codex assistant matches `:1488-1497` and shared `:415-424`.
  - Freshness behavior parity: `seen_qids`, `last_hash`, opencode bell/backoff reset, and stream dedupe logic match across the same ranges.

- **TS subscriber spawn arg shape matches bash.** TS spawns `oc pane_id oc_url session_id parent_pid` at `src/daemon/subscribers/spawn.ts:106`, matching bash `scripts/flightdeck-daemon.bash:1555`; `cc pane_id transcript parent_pid` at TS `:130`, bash `:1241`; `pi pane_id pi_pid pi_socket parent_pid` at TS `:155`, bash `:1421`; `cx pane_id cx_url thread_id parent_pid` at TS `:180`, bash `:1521`.

- **`live-wake.sh --use-ts` is genuine.** `skills/flightdeck/tests/live-wake.sh:56-59` exports both `FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON=1` and `FLIGHTDECK_USE_TS_DAEMON_START=1`; `:216-217` propagates both into the tmux session before `:220-226` starts the daemon window. The daemon wrapper honors the per-script gate and execs Bun, and the TS bin gates `start` into `../daemon/start.ts` at `src/bin/flightdeck-daemon.ts:119,154-156`.

- **Module layout looks clean.** `src/daemon/wake.ts:17` imports `wakePayloadForHarness` from `./wake-payload.ts` and only calls it at `:215`; payload selection is not reimplemented in `wake.ts`. Subscriber logic stays in `scripts/lib/subscribers.bash` plus `src/daemon/subscribers/spawn.ts`; no obvious subscriber behavior is leaking into wake or pane metadata modules.
