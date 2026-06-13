#!/usr/bin/env bash
# Shared project configuration loader for vstack skill scripts.
#
# Load order is intentionally compatible with the historical env-file flow:
#   1. .env
#   2. vstack.settings.toml or .vstack/settings.toml ([env] table only)
#   3. .env.local
#
# The TOML reader is deliberately small and only accepts a public [env] table
# with shell-style variable names:
#
#   [env]
#   WORKTREE_BASE_DIR = "../trees"
#   ORCH_STATE_DIR = "tmp"

vstack_source_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # shellcheck source=/dev/null
  source "$file"
}

vstack_trim() {
  local value="$1"
  value="${value#"${value%%[!$' \t\r\n']*}"}"
  value="${value%"${value##*[!$' \t\r\n']}"}"
  printf '%s' "$value"
}

vstack_unquote_value() {
  local value
  value="$(vstack_trim "$1")"

  if [[ "$value" == \[*\] ]]; then
    value="${value:1:${#value}-2}"
    value="${value//,/ }"
    value="${value//\"/}"
    value="${value//\'/}"
    value="$(vstack_trim "$value")"
  elif [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\"/\"}"
    value="${value//\\\\/\\}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  else
    value="${value%%#*}"
    value="$(vstack_trim "$value")"
  fi

  printf '%s' "$value"
}

vstack_load_settings_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local section="" line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="$(vstack_trim "$line")"
    [[ -z "$line" || "$line" == \#* ]] && continue

    if [[ "$line" =~ ^\[([A-Za-z0-9_.-]+)\]$ ]]; then
      section="${BASH_REMATCH[1]}"
      continue
    fi

    [[ "$section" == "env" && "$line" == *=* ]] || continue
    key="$(vstack_trim "${line%%=*}")"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(vstack_unquote_value "$value")"

    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$file"
}

vstack_load_project_env() {
  local project_root="$1"
  [[ -n "$project_root" ]] || return 0

  vstack_source_env_file "$project_root/.env"
  vstack_load_settings_file "$project_root/vstack.settings.toml"
  vstack_load_settings_file "$project_root/.vstack/settings.toml"
  vstack_source_env_file "$project_root/.env.local"
}
