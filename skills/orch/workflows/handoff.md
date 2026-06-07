# Handoff Workflow

Launch one or more independent work item sessions. This is launch-only.

## Inputs

| Input | Meaning |
|-------|---------|
| `tracker` | `linear` or `github` |
| `items` | Linear IDs or GitHub issue numbers |
| `repo` | Required for GitHub if `gh repo view` cannot resolve |
| `harness` | `claude`, `codex`, `opencode`, or `pi` |

## 1. Confirm Launch

Present:

<output_format>
### Launch Handoff

| Field | Value |
|-------|-------|
| Tracker | [linear|github] |
| Items | [ITEMS] |
| Harness | [HARNESS] |
| Follow-up | No monitoring; each launched session owns its work item |
</output_format>

## 2. Launch

```bash
# Linear
.agents/skills/orch/scripts/open-terminal --tracker linear --harness [HARNESS] [ISSUE_IDS]

# GitHub
.agents/skills/orch/scripts/open-terminal --tracker github --repo [OWNER/REPO] --harness [HARNESS] [NUMBERS]
```

## 3. Return

<output_format>
### Milestone: Handoff Launched

| Field | Value |
|-------|-------|
| Launched | [N] |
| Items | [ITEMS] |
| Monitoring | none |
</output_format>
