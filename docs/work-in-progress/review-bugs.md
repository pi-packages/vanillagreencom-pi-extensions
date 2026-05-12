# Flightdeck TypeScript port bug audit

Scope reviewed:
- `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts`
- `skills/flightdeck/lib/flightdeck-core/src/paths/{daemon,oc,cc,pi,codex}.ts`
- `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts`
- `skills/flightdeck/lib/flightdeck-core/src/bin/{flightdeck-state,parallel-groups,pane-registry,pane-poll,pane-respond,flightdeck-daemon}.ts`
- Bash originals under `skills/flightdeck/scripts/*.bash` and `skills/flightdeck/scripts/lib/*.sh`

## Critical

1. `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts:81-101` and `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts:108-129` — master-state writes are effectively unlocked, and `initState` never even attempts a flock.
   - Description: `updateState` opens the lock file and runs `spawnSync("flock", ["-x", String(lockFd), "true"])`, but the lock is not held while the parent process reads, runs `jq`, writes, and renames. In the normal Node/Bun spawn path the numeric fd is not passed to the child, so the `flock` call likely fails with a bad fd; even if the fd were passed, the lock would be released as soon as the `true` subprocess exits before line 99. `initState` opens `${file}.lock` at line 114 but never calls flock at all before the existence check and rename.
   - Repro / risk window: run two `pane-registry init` / `flightdeck-state set` paths concurrently. Both can read the same old JSON, compute divergent updates, and last rename wins. Worse, one init can pass the `existsSync(file)` check while another process creates and then mutates the file, allowing the late init rename to clobber newly-added `.issues` state.
   - Suggested fix sketch: use a real parent-held advisory lock for the whole critical section. Options: native `flock(2)` binding, a well-tested lockfile package with stale-lock handling, or move the full read/jq/write/rename operation into a single `flock <lockfile> -c '...'` child. Do not treat `flock fd true` as a held parent lock.

2. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:128-177` — `events` / `ack` do not hold `SESSION_LOCK`, breaking the WAKE_PENDING atomic ack contract.
   - Description: `withFlock` uses the same ineffective `spawnSync("flock", ["-x", String(fd), "true"])` pattern at lines 140-142, then runs the JS callback after the helper exits. `drainEvents` and `ackAndDrain` therefore rename/drain `EVENTS_FILE` and clear `WAKE_PENDING` without mutual exclusion against the bash daemon's `append_event` / `wake_master` critical sections.
   - Repro / risk window: while the daemon appends an event and extends `WAKE_PENDING.in_flight` under the real bash lock, a TS `flightdeck-daemon ack --session ...` can concurrently rename the events file and unlink `WAKE_PENDING`. The master can miss newcomer events, or the daemon can believe a wake is still in flight while the ack has removed the marker.
   - Suggested fix sketch: implement real `SESSION_LOCK` locking across the entire drain+clear sequence, matching the bash `ack_and_drain` contract. Add a concurrency test where an append races with `ack` and assert no event is lost and `WAKE_PENDING` state is coherent.

3. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-state.ts:161-177` — `master-busy lock` clears `WAKE_PENDING` without holding the daemon session lock.
   - Description: the bash original takes `fd_session_lock` while writing `BUSY_FILE` and removing `WAKE_PENDING`. The TS port writes `${busyFile}.tmp.<pid>`, renames it, and unlinks `wakePending` with no real `SESSION_LOCK`; the comment at lines 163-166 explicitly accepts this as temp+rename-only, but the daemon contract requires the combined busy-file publish and pending-clear to be atomic against daemon wake paths.
   - Repro / risk window: a master starts a turn and calls `flightdeck-state master-busy lock` while the daemon is in `wake_master` or `append_event`. The daemon can pre-mark a wake pending between the busy write and pending clear, or can observe stale/absent busy state and deliver a wake mid-turn.
   - Suggested fix sketch: take the same `fdSessionLock(fdDir, sidKey)` used by the daemon, hold it from before the busy tmp write through the `WAKE_PENDING` unlink, and only release after both operations complete. This also needs the real-lock fix from finding #2.

4. `skills/flightdeck/lib/flightdeck-core/src/paths/oc.ts:75-87`, `skills/flightdeck/lib/flightdeck-core/src/paths/cc.ts:57-70`, and `skills/flightdeck/lib/flightdeck-core/src/paths/codex.ts:58-70` — adapter port allocators are unguarded read-modify-write sequences.
   - Description: the bash allocators take host-global `oc-ports.lock`, `cc-channel-ports.lock`, or `cx-app-server-ports.lock` across sweep, port probe, JSON update, and rename. The TS allocators read the JSON file, sweep, scan the range, write the selected port, and rename without using the exported lock paths. Releases and PID registration are also unguarded (`oc.ts:90-105`, `cc.ts:72-87`, `codex.ts:73-87`).
   - Repro / risk window: two concurrent terminal spawns can both read an empty/stale ports file, both see the same TCP port as free, both write that port with their own issue/session, and then race to start servers. Later `registerPortPid` / `releasePort` calls can also lose unrelated entries because they rewrite stale snapshots.
   - Suggested fix sketch: hold the corresponding lock for the full allocator/release/register critical section. Keep the TCP free probe inside the lock, and consider binding/listening in the child immediately after allocation or adding a short reservation lifecycle to reduce TOCTOU with non-flightdeck processes.

5. `skills/flightdeck/lib/flightdeck-core/src/bin/pane-respond.ts:253-257` — opencode attach dispatch builds a shell command with JSON string literals, allowing payload expansion/execution and message corruption.
   - Description: `opencodeRunAttach` uses `bash -c` and interpolates `JSON.stringify(message)` into the shell command. JSON double quotes are not shell-safe: `$VAR`, `$(...)`, backticks, and some escapes still expand inside double quotes. The bash original passes `"$message"` as an argv value in a subshell, not as re-parsed shell source.
   - Repro / risk window: responding with payload text like `Use $(git rev-parse --short HEAD)` or code snippets containing `$HOME` changes what opencode receives; command substitutions can execute locally under the user account before the message is sent.
   - Suggested fix sketch: avoid `bash -c` for user payloads. Spawn the opencode process directly with argv (`detached: true`, ignored stdio, log fd opened by parent), or implement robust single-quote shell escaping for every interpolated value and still avoid command substitution contexts.

## Important

1. `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:94-99` and `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:121-123` — `parallel-groups` lock only protects `true`, and writers share a fixed temp path.
   - Description: `withLock` runs `flock -w 5 <lockFile> true`, then releases the lock before the callback. `cmdWrite` and `cmdClear` then both use `${groupsFile}.tmp`, not a PID-unique temp file.
   - Repro / risk window: two `parallel-groups write` calls can compute the same next `group_id`, write the same tmp file, and race `renameSync`. Outcomes include duplicate IDs, lost groups, or `ENOENT`/partial failure when one process renames a tmp file the other expected.
   - Suggested fix sketch: hold a real lock around the callback and use `${groupsFile}.tmp.<pid>` or `mkdtemp` for temp files. Add a concurrent write stress test that asserts unique group IDs and valid JSON.

2. `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts:136-143` — archive renames the state file without the state lock.
   - Description: the bash `archive` action locks `${FILE}.lock` before moving the live state file. TS `archiveState` reads `.terminated_at` and renames the file directly.
   - Repro / risk window: a `set`/`append` can read the live file while `archiveState` renames it away, then recreate `flightdeck-state-<session>.json` from an old snapshot. The archive can miss the final mutation, and a new live file can remain after termination.
   - Suggested fix sketch: reuse the same real state lock as `updateState` around the terminated timestamp read and rename.

3. `skills/flightdeck/lib/flightdeck-core/src/paths/daemon.ts:51-63` — adapter freshness cache writes are unguarded and overwrite corrupt cache as `{}`.
   - Description: `fdAdapterFreshnessCacheSet` does a read/parse/update/write/rename with no use of `fdAdapterFreshnessCacheLock` (`daemon.ts:33-34`). On parse failure it silently resets `obj = {}` and then writes only the new key.
   - Repro / risk window: concurrent freshness probes for different adapters can lose each other's cache entries. If a writer dies mid-write or the cache is otherwise corrupt, the next set masks the corruption and discards all previous entries, producing avoidable fresh probes and stale/fresh flapping.
   - Suggested fix sketch: lock the cache file across read-modify-write. On parse failure, either leave the corrupt file in place and log/return, or rotate it to a `.corrupt.<ts>` file before reinitializing.

4. `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts:79-80` and `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts:112-113` — temp cleanup handles normal exit only, not signal parity.
   - Description: the TS code registers an `exit` handler to unlink tmp files, but does not install `SIGINT` / `SIGTERM` handlers. Node/Bun do not reliably run JS cleanup when the process is terminated by an unhandled signal. The bash originals rely on `trap ... EXIT`, which runs during shell signal exits.
   - Repro / risk window: kill `flightdeck-state set` or `init` after tmp creation but before rename. A `.tmp.<pid>` file can remain until a future `init` happens to call `gcTmpOrphans`; regular `set`/`append` paths never sweep.
   - Suggested fix sketch: register signal handlers that unlink the tmp and then re-raise/exit with the conventional signal code, or centralize tmp creation in a helper that uses `mkdtemp` plus startup GC for every mutation path.

5. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:89-110` and `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:299-300` — daemon commands cannot clean up sessions addressed by tmux session id or already-gone sessions.
   - Description: `resolveSessionId` scans `tmux list-sessions` and only compares the second field (`session_name`) with the input. It does not accept a raw tmux `session_id` even though the bash original does, and if tmux no longer lists the session it returns an empty key. `cmdStop` then has `pidFile === ""` and reports `no daemon` without touching stale daemon files.
   - Repro / risk window: call `flightdeck-daemon stop --session '$143'`, or stop after the tmux session was killed but the daemon/pid files remain. The TS stop path cannot derive the `s143` key and leaves the daemon state/subscriber files stranded.
   - Suggested fix sketch: resolve via `tmux display-message -p -t <input> '#{session_name}|#{session_id}'` like bash. If tmux resolution fails, fall back to a name-keyed cleanup path for compatibility, and consider accepting `s<N>` keys explicitly for recovery.

6. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:330-352` — `stop` reaps subscriber PID files but not subscriber descendant process trees or all per-session files.
   - Description: TS stop sends `SIGTERM` only to the recorded subscriber PID and immediately unlinks the pid file. The bash stop path collects descendants first (to catch `tail -F | jq` / stream children), kills them before the subscriber, and then runs locked cleanup for wake/events/draining state. TS also omits wake-events log, `.draining.*` snapshots, and heartbeat cleanup.
   - Repro / risk window: stop a daemon while a CC/PI/CX subscriber has a pipeline or bridge child. The parent pid file disappears, but child processes can continue holding inherited resources or appending wake events. Stale heartbeat/wake-event files can mislead later health/debug output.
   - Suggested fix sketch: port `collect_descendants` / `kill_all_oc_subscribers` behavior, escalate after a grace period, and call a locked cleanup helper that removes wake pending, events, wake-events, heartbeat, and `.draining.*` files.

7. `skills/flightdeck/lib/flightdeck-core/src/bin/pane-respond.ts:161-163` and `skills/flightdeck/lib/flightdeck-core/src/bin/pane-respond.ts:523-528` — tmux fallback paths ignore send/paste failures and can return success without sending.
   - Description: `tmuxSend` discards `spawnSync` status. Payload mode checks only `tmux load-buffer`; it ignores `paste-buffer`, `delete-buffer`, and trailing Enter statuses. The bash original runs under `set -e`, so failed `tmux send-keys` / `paste-buffer` exits non-zero.
   - Repro / risk window: target pane dies after `pane_is_busy` but before paste, or `tmux paste-buffer` fails due to a bad target. TS exits 0 and may clear the bell even though the response never reached the pane.
   - Suggested fix sketch: wrap tmux commands in a helper that checks `status`, prints stderr/context, and exits 5 (or the bash-equivalent code). Only clear bell after a confirmed send.

8. `skills/flightdeck/lib/flightdeck-core/src/shared/project.ts:24-46` — `.env` loading is not equivalent to bash `source` and can route state to the wrong path.
   - Description: the TS loader parses `KEY=VALUE` text, strips quotes, and never performs shell expansion. The comment says bash sources without expansion, but `source .env.local` does expand shell variables and command substitutions. It also does not handle escaped quotes, `export KEY=value with spaces` shell syntax, or variable references.
   - Repro / risk window: `.env.local` contains `FD_STATE_DIR="$XDG_RUNTIME_DIR/flightdeck"` or `FLIGHTDECK_STATE_DIR=${TMPDIR:-tmp}`. Bash resolves an absolute runtime path; TS stores the literal `$XDG_RUNTIME_DIR/flightdeck` or `${TMPDIR:-tmp}`, splitting state between implementations.
   - Suggested fix sketch: either execute a constrained shell env dump (`set -a; source ...; env -0`) with clear trust assumptions, or document and enforce a strict dotenv subset and update bash to use the same parser. Add tests for quoted values and variable expansion.

9. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:315-327` — missing `flock(1)` during `stop` can fail open and kill based on an ambiguous lock state.
   - Description: `cmdStop` treats only `flockTest.status === 0` as stale/unlocked; any non-zero or `null` status is treated as "lock held" and proceeds to kill the PID. If `flock` is missing or cannot execute, `spawnSync` returns `status: null`, which enters the kill path.
   - Repro / risk window: on a host/container without `flock`, a stale pid file containing a live unrelated reused PID plus an existing lock path causes `flightdeck-daemon stop` to send SIGTERM/SIGKILL to that process instead of refusing as ambiguous.
   - Suggested fix sketch: check `flockTest.error` and `status === null` explicitly and fail closed. Match bash preflight behavior by verifying required commands before state-changing daemon actions.

## Nice

1. `skills/flightdeck/lib/flightdeck-core/src/bin/pane-registry.ts:211`, `skills/flightdeck/lib/flightdeck-core/src/bin/pane-registry.ts:269-277`, `skills/flightdeck/lib/flightdeck-core/src/bin/pane-registry.ts:370-373`, and `skills/flightdeck/lib/flightdeck-core/src/bin/parallel-groups.ts:151` — jq filters interpolate issue IDs / fields directly.
   - Description: several commands build jq source with unescaped user/domain strings instead of `--arg` variables or a JSON pointer helper.
   - Repro / risk window: an issue key or field containing quotes, backslashes, `]`, or jq syntax can make lookups fail or mutate the wrong path. Current tracker IDs are probably simple, so this is mostly a robustness edge.
   - Suggested fix sketch: use `--arg issue "$issue" '.issues[$issue]...'` patterns, or construct object updates in TypeScript and pass whole JSON values to jq only for trusted filters.

2. `skills/flightdeck/lib/flightdeck-core/src/state/master-state.ts:57-62` and `skills/flightdeck/lib/flightdeck-core/src/paths/oc.ts:37-41` — missing dependency behavior drifts from bash and sometimes degrades silently.
   - Description: missing `jq` in `runJq` exits as code 1 because `status` is `null`; bash would normally exit 127 for command-not-found. Missing `bash` in `ocPortIsFree` makes the probe return `true` (free) for every port because only `r.status === 0` is treated as in-use.
   - Repro / risk window: minimal containers or PATH changes can produce different exit codes from bash scripts, or allocate ports without actually probing them.
   - Suggested fix sketch: add command preflight for `jq`, `flock`, `tmux`, `bash`, `curl`, `gh`, and `bun` where those commands are required. Treat `spawnSync.error` / `status === null` as an explicit dependency failure, not as a normal negative probe.

3. `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:90-94` — session names with spaces are parsed incorrectly.
   - Description: `resolveSessionId` splits `#{session_id} #{session_name}` on spaces and reads only the second token as the name.
   - Repro / risk window: a tmux session named `flight deck` appears as `sname === "flight"`, so status/stop/find-window cannot resolve it by name.
   - Suggested fix sketch: use a delimiter that cannot appear in tmux IDs, e.g. `#{session_id}\t#{session_name}`, and split once on tab.

4. `skills/flightdeck/lib/flightdeck-core/src/bin/pane-poll.ts:347-350` — missing `gh` is attempted instead of gated.
   - Description: the bash original checks `command -v gh` before the PR merged fallback. TS spawns `gh` whenever the worktree is absent and `pr` is set, then silently ignores `status !== 0`.
   - Repro / risk window: on systems without GitHub CLI, every orphaned-worktree poll pays a failed spawn and provides no diagnostic. This is not state-corrupting, but it obscures why terminal-state synthesis did not happen.
   - Suggested fix sketch: cache a `gh` availability check or use a resolver helper, and optionally include a debug-level note when the fallback is disabled.
