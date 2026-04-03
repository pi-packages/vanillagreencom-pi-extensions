# Linear CLI

CLI wrapper for Linear's GraphQL API with local cache, bulk operations, and structured output.

## Structure

```
skills/linear/
├── SKILL.md                    # Agent-facing skill definition
├── scripts/
│   ├── linear.sh               # Entry point (resource router)
│   ├── commands/               # Individual resource scripts
│   └── lib/
│       ├── common.sh           # Auth, GraphQL, formatting
│       ├── cache.sh            # Cache management
│       ├── formatters.sh       # Output formatters (safe, table, ids, raw)
│       ├── attachments.sh      # Attachment download and caching
│       └── issue-validation.sh # Issue state validation
└── patterns/
    └── workflow-actions.md     # Multi-step issue/project state transitions
```

## Setup

1. Add `LINEAR_API_KEY` to `.env.local`
2. Optionally set `LINEAR_TEAM` and `LINEAR_TEAM_PREFIX` if defaults don't match

```bash
./scripts/linear.sh auth-check
./scripts/linear.sh sync --reconcile
```

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `LINEAR_API_KEY` | API key (required) | — |
| `LINEAR_TEAM` | Default team name | `Claude` |
| `LINEAR_FORMAT` | Default output format | `safe` |
| `LINEAR_TEAM_PREFIX` | Issue identifier prefix | `CC` |

## Adding a Resource

1. Create `scripts/commands/<resource>.sh`
2. Source `../lib/common.sh`
3. Add `show_help()` function
4. Add to case statement in `scripts/linear.sh`
5. Update Commands table in `SKILL.md`

## Dependencies

- `curl`
- `jq`
