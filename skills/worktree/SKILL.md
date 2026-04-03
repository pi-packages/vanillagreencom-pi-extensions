---
name: worktree
description: "Git worktree management: create, list, remove isolated working copies with env/config symlinks."
license: MIT
user-invocable: true
argument-hint: "create <ID> [--base <ref>] [--pr <N>] | list | remove <ID|path>"
metadata:
  author: vanillagreen
  version: "1.0.0"
---

# Worktree Management

Portable git worktree manager. Layout: `project/main` (repo) + `project/trees/{id}` (worktrees).

Resolves project root via `git rev-parse`, detects default branch automatically, and reads all project-specific config from `.env.local`.

```bash
.agents/skills/worktree/scripts/worktree <command> [options]
```

## Commands

| Command | Description |
|---------|-------------|
| `create` | Create worktree for issue. Reuses existing (with rebase). Auto-detects PR branches via `gh`. |
| `list` | List all worktrees |
| `remove` | Remove worktree, clean symlinks, prune branches |
| `cleanup` | Remove worktrees whose branches are merged |
| `path` | Print worktree path for issue ID |
| `exists` | Check if worktree exists for issue ID |
| `check` | Pre-create git state check (JSON: uncommitted, unpushed) |
| `push` | Push worktree branch with auto-rebase |
