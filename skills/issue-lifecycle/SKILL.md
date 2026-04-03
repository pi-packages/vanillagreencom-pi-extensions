---
name: issue-lifecycle
description: "Agent workflows for issue implementation, review fix delegation, pre-submission PR review, and QA review."
license: MIT
user-invocable: true
dependencies:
  required: [orchestration, github, decider, linear]
metadata:
  author: vanillagreen
  version: "1.2.0"
---

# Issue Lifecycle

Agent workflows for issue implementation, review fix delegation, pre-submission PR review, and QA review. Designed for specialist agents receiving delegations from an orchestrator.

## Workflows

| Workflow | Agent Type | Purpose |
|----------|------------|---------|
| `workflows/dev-implement.md` | Dev agents | Full implementation lifecycle: activate → plan → implement → validate → commit → QA labels → summary → finalize (§ 1-11) |
| `workflows/dev-fix.md` | Dev agents | Process review fix items: evaluate → apply/skip → validate → commit → return |
| `workflows/pr-review.md` | Review agents | Pre-submission PR review: diff → classify findings → JSON report → verdict |
| `workflows/qa-review.md` | QA agents | QA label-triggered review: context → agent review → benchmark recording → JSON report → verdict |

## References

| Topic | Source |
|-------|--------|
| Review finding schema | Orchestration skill (`schemas/review-finding.md`) |
| Recommendation bias | Orchestration skill (`workflows/recommendation-bias.md`) |
| Label application | Project label application guide |
| Benchmark baselines | Project benchmarking skill if installed |
| Regression classification | Project benchmarking skill if available |

## Skill Dependencies

Workflows reference these companion skills and tools. Install and configure per your project:

| Dependency | Purpose | Entry Point |
|------------|---------|-------------|
| Issue tracker CLI (e.g., `linear` skill) | Issue CRUD, cache, comments, labels | `.agents/skills/linear/scripts/linear.sh` |
| Orchestration skill | Review-finding schema, recommendation-bias patterns | Referenced by name |
| GitHub skill | Git diff analysis for QA review context | `.agents/skills/github/scripts/git-diff-summary` |
| Decider skill | Decision templates, search CLI, creation workflows | `.agents/skills/decider/scripts/decisions` |
| Benchmarking | Run benchmarks if a benchmarking skill is installed | Optional |

## Execution Rules

### Sequential Section Execution

Execute all workflow sections in order. Never skip steps because the outcome seems predictable, or rationalize skipping based on change scope ("test-only", "small", "only N items", "already reviewed"). The workflow text is the decision authority, not the agent's assessment.

When a section starts with "**Skip if** [condition]", evaluate the condition literally. If true, skip the section. The workflow decides what to skip, not the agent.

### Format Tags Are Literal

`<delegation_format>` and `<output_format>` tags in workflows define exact content. When sending or presenting content from these tags:

1. **Fill `[PLACEHOLDERS]`** with actual values
2. **Omit lines/sections** where the placeholder value is empty or not applicable
3. **Add nothing else** — no commentary, no extra fields, no rewording
4. **Do not paraphrase** — use the exact structure, headings, and field names from the tag

## Configuration

This skill is workflow-based. All behavior is defined in the workflow files.

Agent types referenced in workflows (names are project-configurable):
- **Dev agents**: `[AGENT_TYPE]` — specialist agents receiving implementation delegations
- **Review agents**: `[REVIEW_AGENT]` — agents that review specific aspects (security, testing, docs, errors, structure)
- **QA agents**: `[QA_AGENT]` — agents for safety, performance, and architecture review

Commit format: `[PREFIX]([ISSUE_ID]): [DESCRIPTION]` — configurable per project conventions.
