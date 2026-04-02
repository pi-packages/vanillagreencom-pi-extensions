---
title: Format Tags Are Literal
impact: CRITICAL
impactDescription: Adding commentary or changing wording in delegation/output tags produces broken delegations and unparseable results
tags: del
---

## Format Tags Are Literal

**Impact: CRITICAL (Adding commentary or changing wording in delegation/output tags produces broken delegations and unparseable results)**

`<delegation_format>` and `<output_format>` tags in workflows define exact content. When sending or presenting content from these tags:

1. **Fill `[PLACEHOLDERS]`** with actual values
2. **Omit lines/sections** where the placeholder value is empty or not applicable
3. **Add nothing else** — no commentary, no extra fields, no rewording, no explanations before or after the content
4. **Do not paraphrase** — use the exact structure, headings, and field names from the tag

The delegated agent or user receives only the filled template. Any additions confuse parsing, break expected formats, or inject context the workflow did not intend.
