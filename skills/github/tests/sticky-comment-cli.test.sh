#!/usr/bin/env bash
# User-facing tests for sticky-comment.sh fallback behavior and live
# detect_bot_reviewers own-comment reaction scanning.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$TEST_DIR/fixtures"
REPO_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
STICKY="$REPO_ROOT/skills/github/scripts/commands/sticky-comment.sh"
LIB="$REPO_ROOT/skills/github/scripts/lib/github-api.sh"

PASS=0
FAIL=0
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

assert_eq() {
    local got="$1" want="$2" name="$3"
    if [[ "$got" == "$want" ]]; then
        PASS=$((PASS + 1))
        printf '  ok    %s\n' "$name"
    else
        FAIL=$((FAIL + 1))
        printf '  FAIL  %s\n        expected: %s\n        got:      %s\n' "$name" "$want" "$got"
    fi
}

assert_fails_with() {
    local name="$1" needle="$2"
    shift 2
    local out status
    set +e
    out=$("$@" 2>&1)
    status=$?
    set -e
    if [[ $status -ne 0 && "$out" == *"$needle"* ]]; then
        PASS=$((PASS + 1))
        printf '  ok    %s\n' "$name"
    else
        FAIL=$((FAIL + 1))
        printf '  FAIL  %s\n        expected failure containing: %s\n        status: %s\n        output: %s\n' "$name" "$needle" "$status" "$out"
    fi
}

cat >"$TMPDIR/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "api" ]]; then
  echo "unexpected gh command: $*" >&2
  exit 1
fi
endpoint="${2:-}"
case "$endpoint" in
  repos/{owner}/{repo}/issues/123/comments)
    cat "$STUB_FIXTURES/mixed_bot_comments.json"
    ;;
  repos/{owner}/{repo}/pulls/123/reviews)
    printf '[]\n'
    ;;
  *)
    printf '[]\n'
    ;;
esac
EOF
chmod +x "$TMPDIR/gh"

export PATH="$TMPDIR:$PATH"
export STUB_FIXTURES="$FIXTURES"
unset GH_BOT_USERNAME || true

echo "=== sticky-comment.sh CLI fallback ==="
out=$("$STICKY" 123 --verdict)
assert_eq "$out" "approved" "default fallback selects known claude[bot] review summary"

assert_fails_with \
    "explicit --bot disables known-bot fallback" \
    "No sticky comment found" \
    "$STICKY" 123 --verdict --bot 'review-bot[bot]'

echo
echo "=== detect_bot_reviewers own-comment reactions ==="
# shellcheck source=/dev/null
source "$LIB"

gh_rest() {
    case "$1" in
        repos/{owner}/{repo}/pulls/42/reviews)
            printf '[]\n'
            ;;
        repos/{owner}/{repo}/issues/42/comments)
            cat "$FIXTURES/codex_own_comment.json"
            ;;
        repos/{owner}/{repo}/issues/42/reactions)
            printf '[]\n'
            ;;
        repos/{owner}/{repo}/issues/comments/4001/reactions)
            cat "$FIXTURES/codex_eyes_body_reactions.json"
            ;;
        *)
            echo "unexpected endpoint: $1" >&2
            return 1
            ;;
    esac
}

detected=$(detect_bot_reviewers 42 | paste -sd, -)
assert_eq "$detected" "chatgpt-codex-connector[bot]" "detect includes Codex own-comment reaction reviewer"

gh_rest() {
    case "$1" in
        repos/{owner}/{repo}/pulls/42/reviews)
            printf '[]\n'
            ;;
        repos/{owner}/{repo}/issues/42/comments)
            cat "$FIXTURES/codex_own_comment.json"
            ;;
        repos/{owner}/{repo}/issues/42/reactions)
            printf '[]\n'
            ;;
        repos/{owner}/{repo}/issues/comments/4001/reactions)
            echo '{"error":"reaction fetch failed"}' >&2
            return 1
            ;;
        *)
            echo "unexpected endpoint: $1" >&2
            return 1
            ;;
    esac
}

if detect_bot_reviewers 42 >/dev/null 2>"$TMPDIR/detect.err"; then
    FAIL=$((FAIL + 1))
    echo "  FAIL  detect propagates own-comment reaction fetch failures"
else
    PASS=$((PASS + 1))
    echo "  ok    detect propagates own-comment reaction fetch failures"
fi

echo
echo "----"
printf 'pass: %d   fail: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
