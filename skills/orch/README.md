# Orchestration

Primary-agent, single work-item orchestration for Linear and GitHub issues.

## Commands

Invoke via your AI coding harness (e.g., `/orch <command>` or `/skill:orch <command>`).

| Command | Description |
|---------|-------------|
| `start [ISSUE_ID]` | Prepare/start one Linear issue |
| `start github OWNER/REPO#N` | Prepare/start one GitHub issue |
| `start new linear\|github ...` | Create one issue, then start it |
| `handoff linear\|github ...` | Launch worktree sessions only; no monitoring |
| `plan-issues PLAN_PATH linear\|github` | Convert plan items into tracker issues |
| `dev-start [ISSUE_ID]` | Delegate implementation to specialist agents |
| `dev-fix [ISSUE_ID]` | Delegate review fix items |
| `ci-fix PR_NUMBER` | Fix CI failures |
| `review [all \| last N \| HASH]` | On-demand code review |
| `review-codebase [PATH]` | Whole-codebase reviewer fanout for a repository/worktree |
| `review-pr [PR_NUMBER]` | Pre-submission review |
| `review-pr-comments PR_NUMBER` | Triage PR review comments |
| `submit-pr [PR_NUMBER]` | Push, create PR, bot review, CI |
| `merge-pr PR_NUMBER \| all` | Verify and merge PR(s) |
| `parallel-check [ISSUE_IDS]` | Verify parallel work safety |

## Skill Dependencies

Install these before using orch workflows:

| Skill | Purpose |
|-------|---------|
| `linear` | Linear issue tracking (CRUD, cache, comments) |
| `github` | PR operations, CI status |
| `worktree` | Git worktree management |
| `project-management` | TPM audit/cycle/roadmap workflows |
| `decider` | Architectural decision documents |

## Configuration

Set in `.env` or `.env.local`, or export in the shell. Helper scripts source both files automatically when present, with `.env.local` taking precedence.

| Variable | Purpose | Default |
|----------|---------|---------|
| `ORCH_STATE_DIR` | State file directory | `tmp` |
| `GH_TOKEN` | Main/user GitHub token for main-repo dashboard reads | current `gh` auth |
| `GH_BOT_TOKEN` | Bot GitHub token for worktree auth and bot operations | current `gh` auth |
| `GH_ISSUE_PATTERN` | Issue ID regex for branch names | `[A-Z]+-[0-9]+` |
| `BOT_REVIEWERS` | Comma-separated review bot usernames | auto-detect |
| `BOT_CHECK_NAME` | CI check name for early review detection | — |

`bot-review-wait --json` fails fast with JSON `status: "error"` when GitHub auth/API reads are not reliable. If an invalid `GH_TOKEN`/`GITHUB_TOKEN` masks working `gh` keyring auth, it unsets those variables for the wait process and continues with a warning. See [`DEVELOPMENT.md`](./DEVELOPMENT.md) for the full auth fallback details and the test runner.

`session-init --json` preserves the structured Linear `auth-check` diagnostic in `.linear_auth.error`. The value `not installed` means the Linear skill command is missing, not that an API key, 1Password, or Linear API check failed.

## System Dependencies

- `jq`, `bash` 4+, `flock` (util-linux)

## Setup

1. Install dependency skills: `github`, `worktree`, `decider`, `project-management`; install `linear` for Linear workflows.
2. Set runtime config in `.env` or `.env.local` (`LINEAR_API_KEY`, `ORCH_STATE_DIR`, etc.).
3. Verify each dependency skill works from the project root before invoking a workflow.

## Codex Desktop Worktrees

When Codex Desktop creates the worktree, configure the worktree skill's `codex-setup` and `codex-cleanup` hooks in the Codex environment. Then run `initialize [ISSUE_ID]` or `start [ISSUE_ID]` with the explicit issue ID; `session-init` will normalize the app-created branch before workflow state is initialized.
