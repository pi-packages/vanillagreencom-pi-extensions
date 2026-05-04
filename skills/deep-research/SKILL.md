---
name: deep-research
description: "Exa-powered deep research for evidence-backed findings reports. Use for research tasks, architectural investigations, vendor/library comparisons, technology choices, and any workflow that needs a findings.md report. In Pi, prefer pi-web-tools web_research when available; in other harnesses, use the bundled script."
license: MIT
user-invocable: true
argument-hint: "report [query] --output findings.md"
dependencies:
  optional: [decider]
metadata:
  author: vanillagreen
  version: "1.0.0"
---

# Deep Research

Use this skill for evidence-backed research reports, architectural investigations, vendor/library comparisons, technology choices, and workflow-owned `findings.md` reports.

## Harness Routing

| Running in | Preferred execution |
|---|---|
| Pi with `web_research` tool active | Use `web_research` with `outputPath` when creating a report. |
| Pi without active tool | Run `scripts/deep-research`. |
| Claude Code | Run `scripts/deep-research`; use `EXA_API_KEY`. |
| Codex | Run `scripts/deep-research`; use `EXA_API_KEY`. |
| OpenCode/Cursor | Run `scripts/deep-research`; use `EXA_API_KEY`. |

## Rules

- Always use Exa for deep research. Do not substitute general web search unless Exa is unavailable and the user explicitly approves a fallback.
- For workflow-owned research, write `findings.md` to the requested research docs path exactly.
- Include citations/source URLs in every findings report.
- Preserve raw Exa metadata when available, either in the report's raw metadata section or a sidecar JSON file.
- If `EXA_API_KEY` is missing, fail with clear setup instructions. `EXA_API_KEY` may be a direct key or a 1Password `op://vault/item/field` reference when the `op` CLI is installed and signed in.
- Prefer `deep-reasoning` unless cost/speed constraints require `deep-lite` or `deep`.

## Script Usage

```bash
skills/deep-research/scripts/deep-research report "question" --output path/to/findings.md
skills/deep-research/scripts/deep-research report --query-file prompt.txt --context context.md --output findings.md
skills/deep-research/scripts/deep-research json "question" --output raw.json
skills/deep-research/scripts/deep-research doctor
```

Common flags:

- `--type deep-reasoning|deep-lite|deep`
- `--output <path>`
- `--query-file <path>`
- `--context <path>` repeatable
- `--system-prompt <path-or-text>`
- `--additional-query <query>` repeatable
- `--include-domain <domain>` repeatable
- `--exclude-domain <domain>` repeatable
- `--start-date YYYY-MM-DD`
- `--end-date YYYY-MM-DD`
- `--num-results <n>`
- `--text-max-characters <n>`
- `--raw-output <path>`
- `--timeout <seconds>`
