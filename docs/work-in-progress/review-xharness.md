# Cross-harness audit — flightdeck TS port

Scope reviewed:

- `skills/flightdeck/lib/flightdeck-core/src/paths/{oc,cc,pi,codex,daemon}.ts`
- `skills/flightdeck/lib/flightdeck-core/src/bin/{pane-poll,pane-respond,pane-registry,flightdeck-daemon}.ts`
- Bash parity sources under `skills/flightdeck/scripts/*.bash` and `skills/flightdeck/scripts/lib/*.sh`

Counts: critical 2, important 5, nice 1.

## all

### critical

- **Harness:** all
- **Severity:** critical
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:128-145`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:930-961`
- **Description:** `withFlock()` does not actually hold the same advisory lock while `events` / `ack` drain and mutate state. It opens a Node fd, spawns `flock -x <fd> true`, ignores the result, then runs JS after the child exits. Child processes do not inherit that arbitrary fd by default, and even if they did, the lock would be released before the JS critical section. Bash keeps fd 201 locked while `recover_stranded_drains`, drain, and wake-pending clear run.
- **Suggested fix:** Move the full drain/ack critical section into a single `flock <lock> sh -c ...` operation, or use a same-process flock implementation (for example `fs-ext`/native binding). Do not treat a short-lived child `flock` probe as a parent-held lock.

### important

- **Harness:** all
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:89-101`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:214-242`
- **Description:** TS daemon session resolution only matches `--session` against `#{session_name}` from `tmux list-sessions`. Bash accepts either a session name or a tmux session id (for example `$143`) via `tmux display-message -t "$input"`, then falls back to using the provided name as `SESSION_KEY` when the tmux session is gone so `stop/status/events/ack` can still clean stale state. TS returns an empty key for session ids and gone sessions.
- **Suggested fix:** Port `resolve_session_pair`: call `tmux display-message -p -t <input> '#{session_name}|#{session_id}'`, derive `fdSessionKeyFromId(session_id)` when present, and otherwise fall back to `sessionName` as the key.

- **Harness:** all
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/flightdeck-daemon.ts:331-348`
- **Bash:** `skills/flightdeck/scripts/flightdeck-daemon.bash:2324-2338`
- **Description:** TS `stop` kills only the subscriber PID recorded in each session-keyed pid file. Bash first collects and kills descendant processes before killing the subscriber, which matters for per-harness subscriber pipelines and bridge subprocesses.
- **Suggested fix:** Port `collect_descendants` behavior or use a process-group/subtree kill before killing each subscriber PID, then unlink the pid file.

## cc

### important

- **Harness:** cc
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/paths/cc.ts:125-128`
- **Bash:** `skills/flightdeck/scripts/lib/cc-channel-paths.sh:45-49`
- **Description:** `ccAdapterIsFresh()` only checks `existsSync(transcript)`, while bash requires `[[ -f "$transcript" ]]`. A directory or other non-regular path can pass the TS freshness probe if `/healthz` is healthy, disabling tmux fallback while `jq` cannot read a valid transcript.
- **Suggested fix:** Replace `existsSync(transcript)` with a regular-file check (`statSync(transcript).isFile()`) before probing `/healthz`.

## oc

### critical

- **Harness:** oc
- **Severity:** critical
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/pane-respond.ts:255-257`
- **Bash:** `skills/flightdeck/scripts/pane-respond.bash:440-442`
- **Description:** The TS detached `opencode run --attach` path builds a `bash -c` string using `JSON.stringify(...)` for shell quoting. That is not equivalent to bash's `"$message"` argv preservation: `$VAR`, command substitutions, backticks, and escaped newlines can be interpreted or transformed by the shell before `opencode` receives the message. Arg order matches bash, but message quoting does not.
- **Suggested fix:** Avoid `bash -c` for this send path. Spawn `opencode` directly with argv `['run','--attach',url,'--session',sid,'--format','json',message]`, detached with ignored stdin and log fds, or use a proven POSIX single-quote escaping helper for every interpolated value.

### important

- **Harness:** oc
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/pane-respond.ts:240-242`
- **Bash:** `skills/flightdeck/scripts/pane-respond.bash:430-432`
- **Description:** TS uses the same `curl --max-time 3` user-count helper for both the pre-send snapshot and post-send polling. Bash uses `--max-time 5` for the pre-send snapshot and `--max-time 3` for post-send polls. If the pre-send snapshot times out in TS, `before` becomes `0`, and a later successful count can falsely confirm delivery even if the new message did not land.
- **Suggested fix:** Match bash: use a 5-second timeout for the initial `before_count` request and 3 seconds for subsequent polling requests.

### nice

- **Harness:** oc
- **Severity:** nice
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/bin/pane-respond.ts:229-233`
- **Bash:** `skills/flightdeck/scripts/pane-respond.bash:386-397`
- **Description:** TS accepts `/usr/bin/opencode` when it merely exists. Bash requires it to be executable (`[[ -x /usr/bin/opencode ]]`) and also checks the `type -P` result is executable.
- **Suggested fix:** Use the same executable-bit check used by the path helpers before selecting `/usr/bin/opencode`.

## cx

### important

- **Harness:** cx
- **Severity:** important
- **TS:** `skills/flightdeck/lib/flightdeck-core/src/paths/codex.ts:155-157`
- **Bash:** `skills/flightdeck/scripts/lib/codex-paths.sh:54-55`
- **Description:** `cxAdapterIsFresh()` reads `FD_CODEX_RPC_TIMEOUT_MS ?? "1000"` but never passes it to `cxBridgeRun`; the local value is discarded. Bash explicitly runs `FD_CODEX_RPC_TIMEOUT_MS="$timeout" cx_bridge_run list --url "$url"`. Because `skills/flightdeck/lib/codex-bridge/bridge.ts` defaults to `30000`, TS freshness probes can be much less bounded than bash when the env var is unset.
- **Suggested fix:** Pass an env override into the bridge spawn, for example `env: { ...process.env, FD_CODEX_RPC_TIMEOUT_MS: timeout }`, or let `cxBridgeRun` accept an env/options parameter used by freshness probes.

## pi

No findings in the requested send path, question API shape, registry/spawn fallback, or freshness-probe parity. `pi-bridge send --auto`, `pi-bridge answer --answers '[[...]]'`, and socket-preferred target args match bash ordering and shape.

## tmux-fallback

No findings in fallback engagement conditions. TS and bash both fall back to `tmux capture-pane` in `pane-poll` only when no fresh adapter args are used, and both fall back to `tmux send-keys` / `paste-buffer` in `pane-respond` only when adapter mode does not engage (or `--keys-allow-tmux` opts out of adapter handling).

## verified parity notes

- `OC_LAST_ASSISTANT_JQ`, `CC_LAST_ASSISTANT_JQ`, `PI_LAST_ASSISTANT_JQ`, and `CX_LAST_ASSISTANT_JQ` are byte-identical to the matching bash variables after extracting the quoted filter bodies.
- Claude send path arg order and body shape match bash: `curl -s -m 10 -X POST -d <message> <url>/`.
- Pi send path arg order matches bash: `pi-bridge send <target-args> --auto <message>`.
- Codex send path arg order matches bash: `cxBridgeRun(['send', '--url', url, '--thread', thread, '--', message])`.
- Opencode question reply/reject and Pi question answer/reject produce the same JSON answer matrix shapes as bash.
