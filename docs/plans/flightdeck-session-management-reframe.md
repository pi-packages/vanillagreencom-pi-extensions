# Flightdeck session-management reframe plan

Date: 2026-05-13

## Goal

Reframe Flightdeck from "multi-issue dev orchestration" into a generic tmux session manager for AI harness sessions. Issue/workflow management remains a first-class mode, but it becomes one domain plugin on top of generic session tracking, not the core abstraction.

Flightdeck should supervise any harness session in a tmux window: launch it, track its stable pane id, communicate through the best harness adapter, surface prompts/questions, wake the owner master, and render owner-scoped dashboard state. When the tracked session is tied to an issue/PR/worktree, Flightdeck additionally enables the existing GitHub/Linear/worktree/merge workflows.

## Why this is needed

A live ad-hoc test showed the current model can mostly supervise a raw Pi session once manually wired into the registry, but the model leaks because every surface assumes a tracked entry is an issue:

- `pane-registry init FD-... --harness pi ...` created a fake issue entry for an ad-hoc session.
- `pane-respond` and the Pi bridge successfully answered structured questions via the registry.
- `flightdeck-daemon` successfully subscribed to the Pi session, emitted `pi-question`, and woke the master via `pi-bridge`.
- `pi-flightdeck` rendered the dashboard in every Pi process in the same repo/tmux session because state is keyed by project root + tmux session name and has no owner gate.
- The dashboard labels everything as issues and showed `daemon dead` until a daemon was started, even though the tracked thing was an ad-hoc session.

So the low-level mechanics are already close to generic session supervision. The schema, command vocabulary, workflows, docs, and Pi UI are still issue-centric.

## Current architecture findings

### Already generic enough to keep

- `pane-respond` is a harness IO adapter: payloads, option picks, structured questions, and tmux fallback already work across Claude Code, OpenCode, Pi, Codex, and tmux fallback.
- `pane-poll` and `flightdeck-daemon` operate on pane ids, harnesses, adapter metadata, hashes, and wake events. Their core loop is session/pane-based, not inherently issue-based.
- `patterns/tmux-monitoring.md` already documents the right durable targeting primitive: persist immutable `%pane_id`; window names auto-rename and are not reliable.
- Pi question routing is generic: daemon emits `pi-question`, `pane-respond --harness pi --question ...` routes to `pi-bridge answer|reject`.
- Daemon state is already scoped by tmux session id (`s<N>`) and tracks subscribers by pane id.

### Issue assumptions to isolate

- `skills/flightdeck/SKILL.md` description, dependencies, commands, mode rules, schema, and workflow list all frame Flightdeck as issue/PR lifecycle management.
- `skills/flightdeck/README.md` describes issue spawning, merge order, PR handling, and new Linear issue recommendations as core behavior.
- `workflows/start.md`, `start-new.md`, `parallel-check.md`, `merge-plan.md`, `close-issue.md`, and `terminate.md` all assume Linear/GitHub/worktree/PR metadata.
- `workflows/watch.md` is partly generic, but registry init, status dashboard, merge planning, terminal states, and handler invocation use `ISSUE_ID` everywhere.
- `workflows/handle-prompt.md` mixes generic prompt handling with issue/PR-specific decision logic.
- `flightdeck-state` initializes `.issues`, `.merge_queue`, and `.conflict_graph`; `phase` reads `workflow-state-<ISSUE>.json`.
- `pane-registry` CRUD keys entries by issue id and stores issue-specific fields (`worktree`, `pr_number`, `scope_files_*`, `orchestration_started`).
- Adapter spawn files are named by issue id (`oc-spawn-<issue>.json`, `pi-spawn-<issue>.json`, etc.).
- `open-terminal` requires issue-like IDs and uses the worktree skill before launching.
- `pi-flightdeck` types and render code use `IssueRecord`, `.issues`, `merge_queue`, `PR`, `worktree`, and "issues" labels throughout.
- `pi-flightdeck` suppresses in child panes only via `PI_SUBAGENT_CHILD_AGENT` or `FLIGHTDECK_CHILD_PANE`; it has no owner identity check.

## Target model

Use two layers:

1. Core session manager — always available.
2. Issue/workflow domain — optional layer for tracked sessions that represent implementation issues.

### Core tracked session

Use a neutral internal term in code: `TrackedEntry` or `TrackedSession`. User-facing UI can say "sessions". Prefer `TrackedEntry` in schema/code to avoid confusion with tmux session and Pi session ids.

Draft schema shape:

```json
{
  "schema_version": 2,
  "session_id": "VS",
  "started_at": "<ISO8601>",
  "terminated": false,
  "owner": {
    "harness": "pi|claude|opencode|codex|unknown",
    "pane_id": "%25",
    "pane_target": "VS:3.1",
    "cwd": "/repo",
    "pid": 1752875,
    "pi_session_id": "...",
    "pi_bridge_socket": "/tmp/pi-session-bridge-1000/pi-1752875.sock"
  },
  "entries": {
    "fd-adhoc-1778630553": {
      "id": "fd-adhoc-1778630553",
      "title": "Adhoc Flightdeck Smoke",
      "kind": "adhoc|issue|workflow",
      "state": "waiting|prompting|submitting|ready|complete|cancelled|dead",
      "substate": null,
      "harness": "pi",
      "cwd": "/repo",
      "window": "6",
      "pane_target": "VS:6.1",
      "pane_id": "%33",
      "launch": { "model": "openai-codex/gpt-5.5", "effort": "medium", "cmd": "pi ..." },
      "adapter": {
        "pi_bridge_pid": 2725883,
        "pi_bridge_socket": "/tmp/pi-session-bridge-1000/pi-2725883.sock",
        "pi_session_id": "...",
        "oc_url": null,
        "oc_session_id": null,
        "cc_url": null,
        "cc_transcript": null,
        "cx_ws": null,
        "cx_thread_id": null
      },
      "domain": {
        "issue": {
          "id": "CC-123",
          "worktree": "/repo/trees/cc-123",
          "pr_number": 123,
          "scope_files_declared": 5,
          "scope_files_actual": 8,
          "orchestration_started": true
        }
      },
      "last_capture_hash": "sha256:...",
      "last_response_at": "<ISO8601>",
      "spawned_at": "<ISO8601>",
      "last_polled_at": "<ISO8601>",
      "decisions_log": []
    }
  },
  "issue_mode": {
    "merge_queue": ["CC-123"],
    "conflict_graph": { "edges": [], "computed_at": null }
  },
  "paused_for_user": null
}
```

Compatibility requirement: read old `.issues` state as `kind: "issue"` entries. During migration, either keep writing `.issues` as a projection or keep old CLI commands as aliases until workflows are fully moved.

## Implementation plan

### Phase 0 — Immediate operational guidance and owner safety

Purpose: stop the exact class of mistakes seen in the ad-hoc test while the larger reframe is built.

1. Add short repo guidance to `AGENTS.md` after implementation is ready:
   - When user asks for a new tmux tab/window for testing, create a new tmux window in the existing session, never split the current pane.
   - Use Flightdeck session tools/skill for harness launch and IO; persist `%pane_id`/`#{window_id}`; do not rely on window names.
2. Add owner metadata to current Flightdeck state init/watch path before broad schema work:
   - `owner.pane_id`
   - `owner.pane_target`
   - `owner.harness`
   - `owner.cwd`
   - Pi owner bridge metadata when master harness is Pi.
3. Update `pi-flightdeck` to render the mini dashboard only for the owner by default.
   - New setting: `dashboardVisibility = owner | tmux-session | always`.
   - Default: `owner`.
   - Popup can show read-only observer info if opened manually, but persistent widget should not appear in peer Pi sessions.
4. Preserve child-pane suppression (`PI_SUBAGENT_CHILD_AGENT`, `FLIGHTDECK_CHILD_PANE`) as an additional guard.

Validation:

- Start one owner Pi session and at least two peer Pi sessions in the same repo/tmux session.
- Create a tracked ad-hoc entry.
- Verify mini dashboard appears only in owner, unless setting is changed.
- Verify `/flightdeck` popup in peer either hides persistent widget or clearly says `Observed Flightdeck owned by %pane`.

### Phase 1 — Normalize state model with backward compatibility

Purpose: introduce generic entries without breaking issue workflows.

1. Add state normalization helpers in `skills/flightdeck/lib/flightdeck-core/src/state/`:
   - `readTrackedEntries(state)` reads `.entries` if present, else maps `.issues` to entries.
   - `writeTrackedEntry(...)` writes `.entries[id]` and optionally updates `.issues[id]` for compatibility.
   - `entryIdForIssue(issueId)` and `issueIdForEntry(entry)` helpers.
2. Add `schema_version` and `owner` to `flightdeck-state init`.
3. Keep existing `.issues`, `.merge_queue`, `.conflict_graph` in v1 compatibility path.
4. Add tests for:
   - v1 `.issues` read compatibility.
   - v2 `.entries` read path.
   - dual-write/projection behavior if used.
   - archives and stale state parsing.

Validation:

```bash
cd skills/flightdeck/lib/flightdeck-core
bun test tests/parity/flightdeck-state.test.ts
bun run typecheck
```

### Phase 2 — Generalize registry and launch APIs

Purpose: make official ad-hoc session management possible without fake issue IDs.

1. Evolve `pane-registry` CLI:
   - Add aliases or new commands using `entry` terminology:
     - `pane-registry init-entry <ENTRY_ID> --title ... --kind ... --cwd ... --window ... --harness ...`
     - `pane-registry list --format json` returns normalized entries while preserving legacy fields for issue entries.
     - `pane-registry find-by-pane` returns entry id, not necessarily issue id.
   - Keep current commands (`init <ISSUE>`, `set-state <ISSUE>`, etc.) as issue-mode aliases.
2. Rename internal variable names from `issue` to `entryId` where code is generic.
3. Split adapter spawn metadata paths away from issue IDs:
   - New `adapter-spawn-<entryId>.json` helpers, or preserve per-harness files but pass `entryId` not issue id.
   - Old files still read for compatibility.
4. Add first-class ad-hoc launch script/API:
   - Option A: extend `open-terminal` with `--session-id`, `--title`, `--cwd`, `--prompt`, and `--cmd` so it can launch without worktree creation.
   - Option B: add `session-terminal` or `flightdeck-session` script and keep `open-terminal` as issue preset.
   - Preferred: add a new script for clarity, then let `open-terminal` call it in issue mode.
5. New launch behavior:
   - Always use `tmux new-window`, not split panes.
   - Capture `#{window_id}`, `#{pane_id}`, `#{window_index}`, and pane cwd immediately.
   - Set `FLIGHTDECK_CHILD_PANE=1` in launched child sessions so pi-flightdeck does not render full owner dashboard inside children.
   - Prefer harness adapters (`pi-bridge`, OpenCode HTTP attach, Claude channels, Codex bridge) over tmux fallback.
6. Add attach behavior for sessions launched manually:
   - `flightdeck session attach --pane %33 --harness pi --title "..."`
   - Discovers adapter metadata where possible.

Validation:

- Launch ad-hoc Pi session through the new official path.
- Attach an existing Pi pane by `%pane_id`.
- Verify registry lists entries with `kind=adhoc` and no issue metadata.
- Verify legacy issue launch still produces equivalent state.

### Phase 3 — Split generic watch loop from issue workflow logic

Purpose: keep the daemon/prompt loop generic, move PR/issue decisions behind domain guards.

1. Refactor `workflows/watch.md` into two conceptual parts:
   - Generic `session-watch.md`: init state, reconcile entries, spawn daemon, poll entries, route generic prompts, ack/yield.
   - Issue `watch.md` extension: merge planning, terminal issue states, PR conflict graph, workflow phase summaries.
2. Generic states:
   - `waiting`
   - `prompting`
   - `submitting`
   - `ready`
   - `complete`
   - `cancelled`
   - `dead`
3. Issue-mode state mapping:
   - `merge-ready` maps to generic `ready` + domain `issue.phase=merge-ready`.
   - `merged` maps to generic `complete` + domain `issue.outcome=merged`.
   - `aborted` maps to generic `cancelled` + domain `issue.outcome=aborted`.
4. Keep existing states in compatibility until all issue workflows are updated.
5. Prompt handler split:
   - Generic handlers: `oc-question`, `pi-question`, `bash-permission-prompt`, `awaiting-direction`, safe `generic-multi-choice`, `terminal-state-reached`/completion signal.
   - Issue handlers: cleanup worktree, bot-review, rebase, force-push, audit relation, merge, descope, review fix suggestions, scope creep.
6. Add handler guards:
   - If an issue-only tag appears on an ad-hoc session, escalate as `domain-mismatch` instead of applying PR/worktree assumptions.
   - If a generic tag appears on an issue session, use generic handler then resume issue flow.

Validation:

- Existing issue workflow tests remain green.
- New ad-hoc session test can answer generic questions and complete without PR/Linear/GitHub calls.
- `generic-multi-choice` on ad-hoc session does not run PR conflict logic.

### Phase 4 — Preserve and isolate issue/workflow management

Purpose: no regression for current Flightdeck users.

1. Keep `flightdeck start [ISSUE_ID]`, `start new`, `parallel-check`, merge planning, and termination summary as issue-mode workflows.
2. Move required dependency language:
   - Core Flightdeck requires tmux and harness adapters only.
   - Issue mode requires `github`, `linear`, `project-management`, and `worktree` as applicable.
3. In `SKILL.md`, change required setup:
   - Always verify `$TMUX`.
   - Load GitHub/Linear/project-management only when entering issue workflow commands.
4. Keep issue commands in command table under `Issue workflows`.
5. Add new generic commands under `Session management`:
   - `session start`
   - `session attach`
   - `session watch`
   - `session status`
   - `session stop` / `session remove`
6. Update termination behavior:
   - Generic sessions end with a session summary, not merge summary.
   - Issue sessions still produce the current issue/PR/new-issue recommendation summary.
7. Keep `pr-conflict-graph`, `parallel-groups`, and issue decision biases untouched except for namespacing/docs.

Validation:

- Run focused issue-mode tests and at least one live issue-mode smoke before any default flip.
- Run generic ad-hoc smoke without Linear/GitHub credentials to prove core mode does not require them.

### Phase 5 — Reframe Pi dashboard and UI language

Purpose: UI reflects sessions first, issue metadata second.

1. Rename TypeScript UI types:
   - `IssueRecord` → `TrackedSession` or `TrackedEntry`.
   - `IssueState` → `TrackedState`.
   - `MasterState.issues` access goes through normalized entries helper.
2. UI copy changes:
   - `issues` → `sessions` / `tracked sessions`.
   - `Dashboard max issues` → `Dashboard max sessions`.
   - `Conflicts & merges` tab hides or renames when no issue-mode entries exist.
   - Rows render optional PR/worktree/scope metadata only when present.
3. Add owner-aware render behavior:
   - Persistent widget shows only in owner by default.
   - Child panes remain suppressed.
   - Observer popup can show `Owner: %pane · harness · cwd` and a setting-controlled read-only view.
4. Update render details:
   - Header counts: sessions by state, plus issue count when issue-mode entries exist.
   - Row label: `title` first, fallback `id`.
   - `kind` badge: `adhoc`, `issue`, `workflow`.
   - Issue-specific PR/worktree details in child rows only.
5. Update package settings, README, and extension manager descriptions.

Validation:

- Render tests/harness snapshots for:
   - no sessions
   - one ad-hoc session
   - one issue session
   - mixed ad-hoc + issue
   - owner vs peer Pi session
   - stale daemon

### Phase 6 — Documentation and repo guidance

Update all docs in the same code change that changes behavior:

- `AGENTS.md`
  - Add 1-2 lines for "new tmux tab/window" requests.
- `skills/flightdeck/SKILL.md`
  - New framing: session manager first; issue/workflow mode second.
  - Dependencies split by mode.
  - Commands table split into core session commands and issue workflow commands.
  - Schema section updated for entries + issue domain metadata.
- `skills/flightdeck/README.md`
  - Product framing: supervise AI harness sessions; issue orchestration is built-in domain mode.
  - Add ad-hoc examples.
  - Retain issue/PR examples.
- `skills/flightdeck/DEVELOPMENT.md`
  - Explain schema v2 compatibility and generic/session vs issue plugin boundaries.
- `skills/flightdeck/patterns/tmux-monitoring.md`
  - Add explicit "new tmux tab/window" operational pattern.
- `skills/flightdeck/patterns/prompt-handlers.md`
  - Split generic vs issue-only handlers.
- `skills/flightdeck/workflows/*.md`
  - Add generic workflows and update issue workflows to call core session primitives.
- `pi-extensions/pi-flightdeck/README.md`
  - Dashboard owner scope and sessions-first language.
- `pi-extensions/pi-flightdeck/package.json`
  - Settings descriptions from issue to session.
- `docs/work-in-progress/flightdeck-dashboard-tui-plan.md`
  - If still active, align its `IssueCard` model with `TrackedEntry`.

Proposed short AGENTS.md wording once implementation supports it:

> When user asks to test in a "new tmux tab/window", create a new tmux window in the current session, never split the active pane. Use Flightdeck session tooling for launch/attach and harness IO; persist `%pane_id`/`#{window_id}` and communicate through the harness adapter (`pi-bridge`, OpenCode HTTP, Claude channels, Codex bridge) before tmux fallback.

## Suggested execution order

1. Owner gating in `pi-flightdeck` and state owner metadata.
2. State normalization helpers with v1 compatibility tests.
3. Generic registry API aliases, leaving existing issue API intact.
4. Official ad-hoc launch/attach path that uses `tmux new-window` and records immutable ids.
5. Generic session watch/handler split.
6. Pi dashboard language/type reframe.
7. Docs/guidance refresh.
8. Only after all tests and live smoke pass, consider updating skill dependencies from hard required to mode-specific.

## Test matrix

### Unit/parity

```bash
cd skills/flightdeck/lib/flightdeck-core
bun test
bun run typecheck
```

Add/extend tests for:

- `flightdeck-state` v1/v2 init/read/archive.
- `pane-registry` generic entry init/list/find/remove.
- `pane-poll` batch rows with generic entries.
- `pane-respond` question routes for generic entries.
- `flightdeck-daemon` ad-hoc session wake.
- `pi-flightdeck` state normalization and owner gating.

### Live smokes

1. Ad-hoc Pi session:
   - Launch owner Pi in repo.
   - `flightdeck session start --harness pi --title "Smoke" --cwd "$PWD" --prompt "ask a question"`.
   - Confirm new tmux window created, not split.
   - Confirm dashboard only owner shows.
   - Answer `pi-question` through `pane-respond`.
2. Peer Pi suppression:
   - Start two other Pi sessions in same repo/tmux session.
   - Confirm no persistent Flightdeck dashboard in peers by default.
3. Legacy issue mode:
   - Launch or no-op dry-run an issue workflow.
   - Confirm `.issues` compatibility and existing prompt handlers still work.
4. Live wake:
   - Run `skills/flightdeck/tests/live-wake.sh` under the relevant gate when touching daemon/wake behavior.

## Compatibility policy

- Do not remove `.issues` support until at least one production cycle after v2 entries ship.
- Do not rename user commands without aliases.
- Do not require GitHub/Linear credentials for core ad-hoc session mode.
- Do not make Pi the only working path; all core abstractions must stay harness-neutral.
- Do not flip daemon `start` to TS default as part of this reframe unless `tests/live-wake.sh` is green under that same change.

## Risks and mitigations

- Risk: schema churn breaks existing issue workflow. Mitigation: normalized read layer, dual-write or projection, and parity tests before workflow edits.
- Risk: dashboard leaks into peer sessions again. Mitigation: owner metadata + default owner-only visibility + peer render tests.
- Risk: terminology confusion between tmux session, Pi session, and tracked session. Mitigation: code term `TrackedEntry`, UI term `session`, explicit fields for `tmux_session_id` and `pi_session_id`.
- Risk: issue-only handler mutates wrong ad-hoc session. Mitigation: domain guards on handler dispatch.
- Risk: launch paths duplicate panes after adapter discovery timeout. Mitigation: mirror current Pi/Codex post-open behavior: if window opened, never fall through to another spawn.
- Risk: one daemon per tmux session conflicts with multiple independent owners. Mitigation: keep one owner per tmux session as invariant for now; document that separate Flightdeck owners require separate tmux sessions.

## Definition of done

- Flightdeck can launch or attach at least one ad-hoc harness session in a new tmux window, track it without fake issue IDs, answer a structured question through the native adapter, and stop/remove it cleanly.
- Existing issue mode still launches, tracks, responds, plans merges, and terminates with the same user-visible behavior.
- Pi dashboard shows sessions-first UI and renders persistently only in the owner Pi session by default.
- README, SKILL.md, workflow docs, Pi extension README/settings, and AGENTS.md guidance match behavior.
- `bun test` and `bun run typecheck` pass in `skills/flightdeck/lib/flightdeck-core`.
- Live ad-hoc smoke and relevant daemon wake smoke pass.
