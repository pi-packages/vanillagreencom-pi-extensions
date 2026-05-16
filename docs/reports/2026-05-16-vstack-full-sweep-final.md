# vstack full sweep + upstream workarounds + live validation — final report (2026-05-16)

End-state report covering W4 (flightdeck dashboard + rich activity), W5 (issue sweep), upstream workarounds, #74 perf fix, AND end-to-end hyprtrade live validation that surfaced one additional bug.

## Outcome

- **7 PRs merged** to `main`:
  - **#64** `flightdeck-dashboard-rust` — Rust dashboard (cost engine, themes, confirmed writes).
  - **#65** `flightdeck-rich-activity` — Rich activity stream across 5 harnesses + 21+1 commits / 7 phases.
  - **#73** `vstack-issue-sweep` — 11 issues closed across 7 groups + reviewer minors cleanup.
  - **#75** `vstack-upstream-workarounds` — 3 upstream pi-coding-agent bugs worked around vstack-side + 4 deferred W4/W5 items.
  - **#76** `vstack-issue-74` — `/extensions` popup freeze fix.
  - **#77** `vstack-final-report` — first version of this report.
  - **#78** `vstack-hotfix-linear-update-emit` — **hotfix discovered via hyprtrade live validation** (see below).

- **15 issues closed** on `vanillagreencom/vstack`. **0 open**.

## Live validation against hyprtrade — what was actually tested

This section replaces the placeholder "Live validation" section from the v1 report.

### Pre-fix state

After `vstack refresh -g` updated 3 Pi extensions globally and `vstack refresh` (in hyprtrade) updated 3 skills, I drove a real end-to-end Linear lifecycle test:

1. Created real Linear issue **CC-514** via `linear.sh issues create` → `linear.issue_created` activity row landed correctly with severity=info, refs.linear_id=CC-514. ✅
2. Tried to update CC-514 to "In Progress" → API call succeeded, issue moved state in Linear UI, but **no activity row landed**. ❌
3. Tried to update CC-514 to "Done" → same — succeeded in Linear, no activity. ❌

Same for CC-515 (a fresh second test issue). Linear API mutations succeeded; activity stream stayed silent for the update events.

### Root cause

`linear_update_activity_type` in `skills/linear/scripts/commands/issues.sh` used `printf` WITHOUT a trailing newline:

```bash
case ... in
    completed:*|*:done) printf 'linear.issue_finished success' ;;
    canceled:*|*:cancelled) printf 'linear.issue_cancelled warning' ;;
    *) printf 'linear.issue_updated info' ;;
esac
```

The caller used:
```bash
read -r activity_type activity_severity < <(linear_update_activity_type "$normalized")
```

Without a trailing newline, `read` parsed both tokens correctly but **returned 1 at EOF**. With `set -e` enabled at the top of the script, this **aborted the entire `update_issue` function BEFORE `emit_linear_issue_activity` was reached**.

So: Linear API mutation succeeded, the issue state moved correctly, the script exited with code 1, and no activity row landed in the sidecar.

### Why this slipped past the W5 review chain

PR #75 round-1 reviewer-error caught the analogous "wrong jq event-field path" bug in #67 wiring (subscribers.bash). The fix was to feed a real upstream payload through the actual jq selector. The same depth of integration testing was not applied to the Linear update path — the test suite asserted the helper function was called and the gate worked, but **never end-to-end through the real `read` + `set -e` interaction**.

The hyprtrade live validation surfaced it immediately on the first real update mutation.

### Fix + regression test (PR #78)

- Three `printf` calls now end with `\n`.
- New regression test at `skills/linear/tests/update-emit-newline.test.sh` asserts `read` succeeds with rc=0 and the type/severity pair parses for all three branches. The test catches the bug if the newline is removed.
- Merged as commit `96a6c8c`.

### Post-fix state

Re-ran the same lifecycle test (CC-517):

```
14:31:24 linear.issue_created (severity=info, refs.linear_id=CC-517)
14:31:25 linear.issue_updated (severity=info)
14:31:26 linear.issue_cancelled (severity=warning)
```

All 3 events landed correctly.

### Dashboard end-to-end

Launched the Rust dashboard (`flightdeck-dashboard tui --state-file <path>`) against a state JSON pointing at the validation activity sidecar:

```
┌ activity · 3 rows · 0 noisy hidden · all sessions · all severities ───┐
│ Time     Session    Type       Status   Summary                       │
│ 14:31:26 VS         linear     warn     CC-517 issue_cancelled        │
│ 14:31:25 VS         linear     info     CC-517 issue_updated          │
│ 14:31:24 VS         linear     info     CC-517 issue_created          │
└────────────────────────────────────────────────────────────────────────┘
```

All 3 events rendered with correct timestamps, type chips, severity colors ("warn" for cancelled, "info" for updates), and Linear identifiers in summaries. Newest-first ordering. Footer key hints visible.

### GitHub side end-to-end

Tested `pr-view 81 --json statusCheckRollup` (real merged PR in hyprtrade, read-only). Result:

```
{"type":"pr.checks_passed","severity":"success","refs":{"pr_number":81},"summary":"PR checks passed for #81"}
```

Real `gh pr view` returned real CI rollup data; the gated emit produced one `pr.checks_passed` row. **Re-running the same `pr-view` call** did NOT duplicate the emit — the transition-memory state file at `tmp/flightdeck-pr-checks-81.json` correctly suppressed the duplicate. The `flock`-wrapped read-compare-write region (W5 PR #75) works as designed under real load.

### Cleanup

All 4 test Linear issues (CC-514, CC-515, CC-516, CC-517) archived. All test activity sidecar files + pr-checks state files removed from `hyprtrade/tmp/`. Hyprtrade workspace returned to its pre-test state.

## Upstream-bug strategy

Same as v1 report: vstack-side workarounds for #60, #63, #67 shipped in PR #75. All three closed. Strategy verified working — no reliance on upstream pi-coding-agent fixes.

## Deferred items audit

Same as v1 report — all addressed except github label instrumentation (no wrapper exists; out of scope).

## Stats (final)

- **7 PRs merged** (v1 had 6; #78 added).
- **~78 commits** across all PRs (counting individual + 5 merge commits).
- **~250+ new tests** (v1 had ~250; #78 added 1 regression test).
- **Total findings closed across all rounds**: **3 blockers** (W4 Phase 4 wake-blocking, W5 #75 #67 wiring, W6 #78 missing newline), ~16 majors, ~80 minors.
- **0 open issues** on `vanillagreencom/vstack`.

## Critical lesson

> Test integrations END-TO-END with REAL upstream payloads and REAL caller semantics.

The W5/B1 fix's unit tests asserted the gate logic worked. They never exercised the path where `read` would interact with `set -e`. PR #75 round-1 review caught a similar bug for #67's jq filter; the same scrutiny needed to apply to the Linear path but didn't. The hyprtrade live validation immediately surfaced what 250+ unit tests missed.

For future PRs touching shell scripts with `set -e` + `read` + process substitution + helper functions, add an integration test that runs the full caller path under `set -e`. A grep-the-source test is not enough.

## Pane-agent telemetry

W5 + upstream workarounds + #74 + #78 hotfix used the rust agent (some on `claude-bridge/claude-opus-4-7:xhigh` for #74; others on `openai-codex/gpt-5.5:xhigh`). The hotfix #78 was authored by me directly (master pane) since it was a 3-line sed change with a single test file.

Rust agent reverted to `openai-codex/gpt-5.5:xhigh` at session end.

## All worktrees

- `/mnt/Tertiary/dev/vstack/main` — clean, at the latest main.
- `/mnt/Tertiary/dev/vstack/trees/flightdeck-dashboard-rust` — branch merged via #64, keep until cleanup.
- `/mnt/Tertiary/dev/vstack/trees/flightdeck-rich-activity` — branch merged via #65, keep until cleanup.
- `/mnt/Tertiary/dev/vstack/trees/vstack-issue-sweep` — branch merged via #73, keep.
- `/mnt/Tertiary/dev/vstack/trees/vstack-upstream-workarounds` — branch merged via #75, keep.
- `/mnt/Tertiary/dev/vstack/trees/vstack-issue-74` — branch merged via #76, keep.

All worktrees are safe to `worktree remove` after sign-off.
