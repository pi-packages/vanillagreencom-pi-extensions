---
description: Audit vstack Pi extensions against a pasted Pi core changelog and apply needed fixes
---
Audit `pi-extensions/*` against the Pi coding-agent changelog section pasted **immediately after this command**. Identify which changes require code edits, doc updates, or removals in our extensions; apply the ones that should ship; leave the rest documented with reasoning.

## Intent
The pasted changelog covers a single Pi core release (or a contiguous range). Earlier releases are assumed already absorbed in this repo. Pi changelog source: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md>.

For every changelog entry, decide whether our extensions need to change. Do not invent work that isn't supported by an entry; do not skip an entry that touches a surface we own.

## Inputs
- The pasted changelog text immediately following the command invocation. Treat headings (`### Added`, `### Changed`, `### Fixed`, etc.) and bullet lines as the authoritative item list.
- Issue/PR numbers in the changelog (e.g. `#4818`, `#4821`). Fetch the linked issue or referenced source on github if the bullet alone is ambiguous about which field/behavior changed.

## Hard rules
- Do not bump any extension package version unless the user explicitly asks. `vstack refresh -g` ships behavior changes without a version bump.
- Do not bump the CLI version or cut a release; that is `/gh-release`.
- Do not npm-publish; that is `/npm-deploy`.
- Stage only intended files in each commit. Mention unrelated dirty files; stop and ask if anything looks unintentional.
- After every committed extension change, run `vstack refresh -g` and report which packages were updated. The Pi extension development workflow in `CLAUDE.md` is binding: commit first, then refresh.
- Do not claim "fixed" or "shipped" until commit + refresh both completed and reported.
- If you cannot live-test inside Pi, say so explicitly rather than asserting parity.

## Audit process
1. **Enumerate extensions.** `ls pi-extensions/` — every subdir with a `package.json` is in scope.
2. **Classify each changelog entry** into exactly one bucket:
   - **Required parity fix** — Pi core changed a behavior we override, mirror, or duplicate (e.g. a tool renderer we replace, a hook event shape, a settings.json field we read/write). Off-by-one bugs in helpers we copied count here.
   - **Optional improvement** — Pi exposed a new SDK field, helper, or event that could simplify our code, but our current code is still correct.
   - **Non-impact** — Pi core internals, provider/auth fixes, Windows/macOS platform fixes, theme picker UI, or other surfaces outside our extension code.
3. **For each Required and Optional item:**
   - Grep our extensions for the affected symbol/field/regex/file pattern. Cite the exact `path:line`.
   - If a referenced Pi-side field name is unclear, fetch the relevant Pi source file from <https://github.com/earendil-works/pi-mono> to confirm before editing.
   - Decide: ship now, defer, or skip. Record reasoning.
4. **For Non-impact items:** one-line justification each — enough that re-reading the audit later confirms it was considered.

## Apply fixes
For every "ship now" item:
1. Edit the canonical extension files only — never touch `.pi/`, `.claude/`, `.opencode/`, `.codex/`, `.agents/`, `.cursor/` mirrors.
2. If a fix touches a behavior covered by `hooks/*.sh`, mirror it in `pi-extensions/pi-hooks/extensions/hooks.ts` in the same commit (parity rule in `CLAUDE.md`).
3. If a fix changes user-visible behavior or settings, update the matching README/SKILL.md/`vstack.toml`/`.env.local.example` payload in the same commit.
4. Add or extend a unit test where the fix is testable in isolation (favor regression coverage on numeric helpers, parsers, off-by-one bugs).
5. Run any package-local test suite the fix touches. Document the result (pass/fail, count). If peer-dep imports prevent local execution, link the bundled Pi modules from `/usr/lib/node_modules/pi/node_modules/@earendil-works/*` into a temporary `node_modules/@earendil-works/` (symlinks only), run the tests, then remove the temp `node_modules/` and any generated lockfile so the working tree stays clean.
6. Group related fixes into one commit per logical change. Multi-package fixes for the same Pi changelog item belong in one commit with a subject listing the affected packages.
7. After commit(s), run `vstack refresh -g` and capture the "Pi package(s) updated" line.

## Final report
Produce a structured summary:
- **Pi release covered:** version + date from the pasted changelog header.
- **Classified entries:** count per bucket (Required / Optional / Non-impact).
- **Shipped:** commit hash + one-line subject for each commit; affected extensions; tests run with pass count.
- **Deferred / skipped (with reason):** Optional items not taken, plus the reasoning (e.g. "Pi exposes unified `details.patch` string; our renderer needs `StructuredDiff` tokens for split view, no net simplification").
- **Non-impact log:** bulleted list of entries with one-line justification.
- **Refresh result:** packages reported updated by `vstack refresh -g`.
- **Working tree:** confirm `git status --short` is clean.

## Notes
- Pi `pi update` only reconciles `git:` and `npm:` scheme entries in Pi's `settings.json`. Vstack-installed extensions live as path packages (`./packages/<name>`) so they are out of scope for Pi-side `pi update` git-ref reconcile changes; flag this explicitly when a changelog entry mentions `pi update`.
- Changes to model/provider config (Bedrock, Copilot, OpenCode Zen routing, `compat.*` flags) do not touch our extension surface unless we override a provider — confirm by grepping for the affected provider id before classifying as Non-impact.
- Read tool, bash tool, edit tool, write tool, and search/list tool renderers are owned by `pi-tool-renderer` and override Pi defaults. Pi core UX changes to these tools are a UX choice for us, not an automatic must-mirror; ask the user when default behavior diverges.
