# Initialize Session

Set up team, auth, cache, and workflow state for a worktree session.

## Inputs

| Command | Flow |
|---------|------|
| `initialize` | § 1 → § 2 |
| `initialize [ISSUE_ID]` | § 1 → § 2 |
| (from start-worktree.md) | Managed lifecycle with caller context |

**Caller context parameters** (via `⤵`):
- `lifecycle` (optional): `"managed"` (return to caller at § 2) | `"self"` (default, standalone).
- `issue_id` (optional): Issue ID. If absent, extracted from branch.

---

## 1. Initialize

**Create team first — before any other steps.**

1. **Extract ISSUE_ID**:
   - From argument if provided
   - Otherwise from branch: `git rev-parse --abbrev-ref HEAD` → parse `$ISSUE_PATTERN` (case-insensitive, project-configurable)

2. **Run**: `.agents/skills/orchestration/scripts/session-init`

3. **If `gh_auth` is false or issue tracker auth is false** → report error and fix before proceeding.

4. **Set `WORKTREE_PATH`** to current working directory.

5. **Sync cache**:
   ```bash
   .agents/skills/linear/scripts/linear.sh sync --reconcile
   ```

6. **Init workflow state**:
   ```bash
   .agents/skills/orchestration/scripts/workflow-state init [ISSUE_ID] --team "[ISSUE_ID_LOWERCASE]" \
     --agent "[AGENT]" --worktree "[WORKTREE_PATH]" --branch "[BRANCH]"
   ```
   QA fields (`--qa-labels`, `--sub-issues`) set later via `.agents/skills/orchestration/scripts/workflow-state set` when known.

---

## 2. Return State

**If managed**: Return to the parent workflow's next section.

**If standalone**: Session complete — session initialized.
