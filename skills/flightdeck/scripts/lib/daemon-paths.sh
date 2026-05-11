#!/usr/bin/env bash
# Shared daemon-state path resolution. Sourced by flightdeck-daemon and by
# flightdeck-state's master-busy action so both writers agree on where the
# busy lock and other daemon-process files live.
#
# Single source of truth. Both scripts source this file; do not duplicate
# the env-var resolution or the file-name conventions elsewhere.
#
# Env:
#   FD_STATE_DIR  Daemon state directory.
#                 Default: $XDG_RUNTIME_DIR/flightdeck if set, else
#                          /tmp/flightdeck-$UID. Created mode 0700.
#
# Distinction from project state:
#   - flightdeck-state's per-session JSON files (flightdeck-state-<S>.json)
#     stay in $PROJECT_ROOT/$FLIGHTDECK_STATE_DIR (project-scoped, human-
#     inspectable, archived on terminate).
#   - Daemon-process files (busy lock, pid, log, wake-pending, events,
#     session-lock) live in FD_STATE_DIR — fast, ephemeral, user-private.
#   - The busy lock specifically must be visible to BOTH the master agent
#     (writes via flightdeck-state) AND the daemon (reads); resolving it
#     here unifies the two paths.

# Resolve the daemon state directory and ensure it exists with safe perms.
# Idempotent — safe to call multiple times.
fd_resolve_state_dir() {
  local dir
  if [[ -n "${FD_STATE_DIR:-}" ]]; then
    dir="$FD_STATE_DIR"
  elif [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    dir="$XDG_RUNTIME_DIR/flightdeck"
  else
    dir="/tmp/flightdeck-$(id -u)"
  fi
  mkdir -p "$dir" 2>/dev/null || true
  # Best-effort 0700; ignore failure on filesystems that don't support chmod.
  chmod 0700 "$dir" 2>/dev/null || true
  echo "$dir"
}

# Per-session-key file path helpers. KEY is the daemon's session key
# (`s<N>` derived from tmux session_id), not the human session name.
fd_busy_file()         { echo "$1/fd-master-${2}.busy"; }
fd_pid_file()          { echo "$1/fd-daemon-${2}.pid"; }
fd_pid_lock()          { echo "$1/fd-daemon-${2}.lock"; }
fd_log_file()          { echo "$1/fd-daemon-${2}.log"; }
fd_session_lock()      { echo "$1/fd-daemon-${2}.session-lock"; }
fd_wake_pending()      { echo "$1/fd-wake-pending-${2}"; }
fd_events_file()       { echo "$1/fd-daemon-events-${2}.jsonl"; }
fd_heartbeat_file()    { echo "$1/fd-daemon-${2}.heartbeat"; }

# Host-user-scoped adapter freshness cache. Strong freshness probes can cost
# an HTTP/WebSocket round trip, so pane-registry / pane-poll cache the boolean
# result briefly (default 5s) keyed by adapter URL + session/thread.
fd_adapter_freshness_cache_file() { echo "$(fd_resolve_state_dir)/fd-adapter-freshness-cache.json"; }
fd_adapter_freshness_cache_lock() { echo "$(fd_resolve_state_dir)/fd-adapter-freshness-cache.lock"; }

fd_adapter_freshness_cache_get() {
  local key="$1" ttl="${2:-${FD_ADAPTER_FRESHNESS_TTL:-5}}"
  [[ "$ttl" =~ ^[0-9]+$ ]] || ttl=5
  (( ttl <= 0 )) && return 1
  local file; file=$(fd_adapter_freshness_cache_file)
  [[ -f "$file" ]] || return 1
  local row ok ts now age
  row=$(jq -r --arg k "$key" '(.[$k] // empty) | [.ok, .ts] | @tsv' "$file" 2>/dev/null) || return 1
  [[ -n "$row" ]] || return 1
  ok=$(awk -F'\t' '{print $1}' <<< "$row")
  ts=$(awk -F'\t' '{print $2}' <<< "$row")
  [[ "$ts" =~ ^[0-9]+$ ]] || return 1
  now=$(date +%s)
  age=$(( now - ts ))
  (( age < 0 )) && age=0
  (( age <= ttl )) || return 1
  [[ "$ok" == "true" || "$ok" == "false" ]] || return 1
  echo "$ok"
}

fd_adapter_freshness_cache_set() {
  local key="$1" ok="$2"
  [[ "$ok" == "true" || "$ok" == "false" ]] || return 1
  local ttl="${FD_ADAPTER_FRESHNESS_TTL:-5}"
  [[ "$ttl" =~ ^[0-9]+$ ]] || ttl=5
  (( ttl <= 0 )) && return 0
  local file lock tmp now
  file=$(fd_adapter_freshness_cache_file)
  lock=$(fd_adapter_freshness_cache_lock)
  [[ -f "$file" ]] || echo '{}' > "$file"
  now=$(date +%s)
  exec 223>"$lock"
  flock 223
  tmp="${file}.tmp.$$"
  if jq --arg k "$key" --argjson ok "$ok" --argjson ts "$now" '.[$k] = {ok:$ok, ts:$ts}' "$file" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$file"
  else
    rm -f "$tmp"
  fi
  exec 223>&-
}

# Derive session key from a tmux session_id like "$143" → "s143".
fd_session_key_from_id() {
  local id="$1"
  [[ -z "$id" ]] && { echo ""; return; }
  echo "s${id#\$}"
}
