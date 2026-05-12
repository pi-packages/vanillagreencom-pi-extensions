# Daemon run-loop port — final big task

The previous 3 review rounds verified the foundation (state, paths,
locking, classifier, registry, poll, respond, daemon CLI surface) is
solid: 123 tests passing, no critical findings, real flock everywhere,
.env parity, preflight parity. This dispatch tackles the last
deferred piece: porting `flightdeck-daemon start` from bash to TS.

## Scope

Bash source: `skills/flightdeck/scripts/flightdeck-daemon.bash`, lines
roughly 322-2131 (everything BELOW the existing daemon helpers you
already ported and ABOVE the `start` action dispatch). The `start`
action body itself is at line 2132 onwards — that's the entry that
forks into the run-loop.

You'll be porting roughly 1500 LOC of bash. Established session 2
foundation is ready to reuse: `src/daemon/{log,gc,wake-payload}.ts`.
The new code lives in `src/daemon/` and ports the bash functions
listed below.

## Module breakdown (suggested layout)

```
src/daemon/
  log.ts           # DONE (session 2)
  gc.ts            # DONE (session 2)
  wake-payload.ts  # DONE (session 2)

  busy.ts          # is_master_busy, clear_stale_wake_pending
  events.ts        # append_event, recover_stranded_drains (drain_events
                   # and ack_and_drain are already in src/bin/flightdeck-daemon.ts
                   # via lockedEventsDrain — confirm they still match)
  pane-meta.ts     # resolve_pane_id, refresh_pane_cache, pane_target_from_id,
                   # bell_flag_for_pane, activity_flag_for_pane,
                   # pane_in_mode_for_pane, pane_alive, session_alive,
                   # capture_pane, stability_for_harness, classify_buffer
  wake.ts          # wake_master, resolve_pi_master_pid, clear_bell_for_window,
                   # locked_rm_wake_pending, locked_cleanup_for_key
  subscribers/
    oc.ts          # oc_subscriber_loop, spawn_oc_subscriber,
                   # collect_descendants, kill_all_oc_subscribers,
                   # recover_stranded_oc_drains, drain_oc_wake_events,
                   # resolve_oc_meta, oc_bell_marker_file,
                   # bell_marker_mtime, touch_oc_bell_marker
    cc.ts          # cc_subscriber_loop, spawn_cc_subscriber, resolve_cc_meta
    pi.ts          # pi_subscriber_loop, spawn_pi_subscriber, resolve_pi_meta
    cx.ts          # cx_subscriber_loop, spawn_cx_subscriber, resolve_cx_meta
  lifecycle.ts     # signal trap installation, heartbeat writer,
                   # max-lifetime self-exec, startup gc, dependency
                   # preflight (use existing src/shared/preflight.ts FULL_REQUIRED)
  loop.ts          # the main run_loop function — calls into the modules above
  start.ts         # spawn mode dispatch (detach via setsid+nohup vs
                   # tmux-window via tmux new-window), pid file write,
                   # session-lock acquisition with retry
```

Then `src/bin/flightdeck-daemon.ts` drops the `start` forward and
calls `start()` from `src/daemon/start.ts` directly.

## Required behavior

The new TS daemon must be **byte-equivalent in observable behavior**
to the bash daemon. Specifically:

1. **State files identical.** PID, log, heartbeat, busy, wake-pending,
   events, wake-events.log, subscriber pid files — same paths, same
   shapes, same locking discipline.
2. **Wake delivery payload identical.** `wake_payload_for_harness` is
   already ported and tested; reuse it.
3. **Atomic master-busy + WAKE_PENDING contract preserved.** master's
   turn-end `ack` continues to work whether the daemon is bash or TS.
4. **Signal handling.** SIGTERM/SIGINT clean up subscriber subtrees
   (use `collectDescendants` from `src/bin/flightdeck-daemon.ts`),
   remove pid + lock files, run `lockedCleanupState`.
5. **Spawn modes both work.** `--in-tmux-window` and the default
   detach (setsid + nohup). The detach path needs a sentinel
   process / proper double-fork to survive the trampoline pipeline.
6. **Max-lifetime self-exec.** When `FD_MAX_LIFETIME` is exceeded,
   `process.execve` (via Node-spawn-replace or `Bun.spawn` + parent
   exit) — same PID-preserving handoff as bash's `exec`.
7. **Heartbeat written every `FD_HEARTBEAT_TICKS` ticks** (default
   60). File at `fd_heartbeat_file(stateDir, sessionKey)`.

## Subscriber semantics

Per-harness subscribers are long-running children that stream
events into `fd-wake-events-<sessionKey>.log`. The daemon's main
loop drains that file (via `drain_oc_wake_events`) and decides
when to wake master.

Each subscriber loop has this shape:
- Connect to the harness's stream (curl + jq for oc, tail JSONL
  for cc, `pi-bridge stream` for pi, codex bridge events for cx)
- On a new event, append to the wake-events log under flock
- Reconnect on disconnect; exponential backoff capped at
  `FD_OC_BACKOFF_MAX_SEC` (default 16) for oc

These are the **hardest** part of the port because they're
long-running cooperative async work. Options:
- (a) Port each subscriber loop as a separate child process
  (`Bun.spawn` with the same shell command as bash). Simplest
  parity path.
- (b) Native async TS streams using `fetch` + ReadableStream for
  oc, `fs.watch` for cc, `Bun.spawn` for pi-bridge stream and
  codex bridge. Faster but more code.

Recommend **(a) for first pass.** Port the subscriber bodies as
`bun -e` inline scripts spawned by the daemon. Once parity is
green, optionally collapse into native streams in a follow-up.

## Tests required

Add `tests/parity/daemon-runloop.test.ts` covering:

1. **Spawn + status round-trip:** start TS daemon, assert pid file
   exists, heartbeat updates within 2s, `status` reports running.
2. **Stop is clean:** spawn TS daemon with a fake inner pane, stop
   it, assert no orphaned subscriber processes, no leaked pid
   files, no stale heartbeat/wake-pending/events.
3. **Bell wakes master:** spawn TS daemon, ring bell on inner pane,
   assert wake event appears in the events file with the expected
   payload.
4. **Atomic ack contract:** start a turn (write busy file), have
   the daemon append an event during the turn, `ack` returns the
   event, WAKE_PENDING is cleared.
5. **Heartbeat:** assert mtime updates every `FD_POLL_SEC *
   FD_HEARTBEAT_TICKS` seconds.
6. **Max-lifetime self-exec:** set `FD_MAX_LIFETIME=2`, spawn,
   wait 3s, assert PID file still has the same PID (process
   replaced itself).

Plus extend `skills/flightdeck/tests/live-wake.sh` with a `--use-ts`
mode that sets `FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON=1` and asserts
the same wake-delivery outcome through pi-bridge. Both modes (bash
default and TS) must pass the same assertions.

## Footguns from the bash original

- **Detach via setsid + nohup with output redirected to `$LOG`**:
  the trampoline pipeline closes file descriptors after spawn.
  Bash uses `setsid nohup ... </dev/null >>"$LOG" 2>&1 &` plus
  `disown`. TS equivalent: `Bun.spawn(['setsid', '--fork', '/proc/self/exe',
  '...args...'], { stdio: ['ignore', logFd, logFd], detached: true })`
  with the parent process explicitly NOT awaiting the child.
- **PID-file race:** bash retries `flock -n` up to 30 × 0.2s
  (6s grace). Same pattern in TS.
- **Self-exec preserves PID:** bash uses `exec` which replaces the
  process in-place. In TS, the equivalent is `process.execve` (not
  available) OR spawning a new process that writes back the same
  PID file. Workaround: instead of preserving PID, the daemon can
  spawn a successor and then exit — losing PID continuity is okay
  if the next daemon writes the same `BUSY_FILE`/`PID_FILE` shape.
  Document the divergence if you take this path.
- **Subscriber pipeline children:** `curl ... | jq ... >>events.log`
  spawns a pipeline. When the daemon stops, only the curl pid is
  in the subscriber pid file — `collect_descendants` walks to find
  the jq child. You already have `collectDescendants` ported.
- **Bell flag handling:** tmux bell flag is on the **window**, not
  the pane. `bell_flag_for_pane` resolves through `refresh_pane_cache`
  which calls `tmux list-panes -a -F '#{pane_id} #{window_bell_flag} ...'`.

## Process

1. Read the bash source carefully — it's a lot but the structure is
   well-documented in comments.
2. Port module-by-module in this order: busy, events, pane-meta,
   wake, lifecycle, subscribers (oc → cc → pi → cx), loop, start.
3. Each module gets unit tests where possible. Loop + start get
   parity/integration tests.
4. Commit per module (or per logical grouping). Keep commits small
   so each one is reviewable independently.
5. After all modules ported AND parity tests green, run the live
   integration test (extend `live-wake.sh`).
6. Send final report when complete.

## Out of scope

- Native streams (async fetch / fs.watch / WS) for subscribers — do
  the bash-spawn approach first. Native can land in a separate session.
- Removing the `.bash` siblings. They stay as fallback until at least
  one stable cycle on TS in production.
- Flipping per-script defaults to TS — parent will do that after
  live-test green.

## After this round

When you've reported done:
- Parent runs reviewers on the new daemon code (3-reviewer sweep
  expected given the size).
- Any findings will dispatch another fix round.
- After reviewers approve AND live-test green, parent flips
  trampoline defaults to TS and runs final doc audit.
- That's the end of the port.
