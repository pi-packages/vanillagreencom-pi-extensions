# GitHub issues — resolve in worktree branch

Three open issues on `vanillagreencom/vstack` filed against the
current `main` HEAD that flightdeck depends on. The user wants
ALL THREE resolved in this worktree branch (no main-branch work).
See the issue bodies via `gh issue view N --repo vanillagreencom/vstack`.

## Issue #8 — pi-flightdeck dashboard renders in flightdeck-launched child panes

**Root cause:** `pi-extensions/pi-flightdeck/extensions/flightdeck.ts:930`
gates suppression on `process.env.PI_SUBAGENT_CHILD_AGENT`, which is
only set by `pi-agents-tmux`'s subagent launcher. Flightdeck-launched
panes (`skills/flightdeck/scripts/open-terminal` →
`spawn_pi_bridge_tmux`) don't set it.

**Fix (one commit, three files):**
1. `skills/flightdeck/scripts/open-terminal` — in `spawn_pi_bridge_tmux`
   (around line 808), prefix the assembled `cmd` with
   `FLIGHTDECK_CHILD_PANE=1` so the env var is exported into the child
   pi process. (Use `env FLIGHTDECK_CHILD_PANE=1 ...` form so it works
   in the shell-join string.)
2. `pi-extensions/pi-flightdeck/extensions/flightdeck.ts:930` — extend
   the check:
   ```ts
   const inChildPane = Boolean(
     process.env.PI_SUBAGENT_CHILD_AGENT ||
     process.env.FLIGHTDECK_CHILD_PANE
   );
   ```
3. `pi-extensions/pi-flightdeck/README.md` — add a sentence to the
   "Child subagent panes" section explaining flightdeck-launched panes
   are also suppressed via `FLIGHTDECK_CHILD_PANE`.

After commit: run `vstack refresh -g` to push the pi-flightdeck change
into the global install.

**Verify:** spawn a pi pane via `open-terminal ISSUE --harness pi`,
confirm no persistent dashboard widget renders inside it; master
flightdeck pane still shows dashboard.

## Issue #9 — pi master wake delivery broken (downstream of #10)

**Root cause:** Wake payload `/skill:flightdeck watch --from-daemon` is
rejected as `Unknown command` when delivered via `pi-bridge send`
because pi-bridge bypasses pi's slash-command resolvers (the upstream
#10 bug). The flightdeck daemon queues events correctly but the master
never wakes.

**Fix at the flightdeck level (workaround for #10 until pi-mono fix
lands):**

1. `skills/flightdeck/scripts/flightdeck-daemon.bash` (line 593) AND
   `skills/flightdeck/lib/flightdeck-core/src/daemon/wake-payload.ts`
   (line 16) — change pi wake payload from
   `/skill:flightdeck watch --from-daemon` to
   `/flightdeck watch --from-daemon`. The bare `/flightdeck` extension
   command IS dispatched correctly via `pi-bridge send` because it
   goes through the `_tryExecuteExtensionCommand` branch (which
   pi-bridge DOES call) rather than the `_expandSkillCommand` branch
   (which it doesn't).

2. `pi-extensions/pi-flightdeck/extensions/flightdeck.ts:1177-1180` —
   currently the `/flightdeck` command handler only does `openPopup`.
   Extend it to parse arguments: if the first arg is `watch`, route
   to the flightdeck skill's watch workflow (the same path
   `/skill:flightdeck watch` would have hit). Use `ctx.ui.pasteToEditor`
   to dispatch `/skill:flightdeck watch --from-daemon\n` — that hits
   the interactive editor's full slash-resolver path. Per repo notes:
   > From an extension, use `ctx.ui.pasteToEditor("/skill:foo\n")`
   > (user submits). No public API auto-submits.
   The pasteToEditor approach paired with a newline submits the line
   automatically in current pi versions; verify in a smoke test.

3. Update parity tests in `tests/unit/wake-payload.test.ts` and any
   related tests to assert the new pi payload.

4. Bump the wake-payload jq filter / docstring comments referencing
   the old payload.

5. `pi-extensions/pi-flightdeck/README.md` — document the
   `/flightdeck watch` extension command form.

After commit: `vstack refresh -g`.

**Verify:** flightdeck master in pi runs an issue, daemon queues a
wake, master receives `/flightdeck watch --from-daemon` and dispatches
properly through the extension command path; daemon log shows
`harness=pi via=pi-bridge` and the master pane actually executes the
watch workflow.

## Issue #10 — pi-bridge bypasses pi's slash-command resolvers (upstream)

**Root cause:** `pi.sendUserMessage()` hardcodes
`expandPromptTemplates: false` in pi-mono (`@earendil-works/pi-coding-agent`).
That skips:
1. `_tryExecuteExtensionCommand` (`pi.registerCommand` dispatch)
2. `_expandSkillCommand` (`/skill:<name>` expansion)
3. `expandPromptTemplate` (prompt templates from `.pi/prompts/*`)

**Caveat:** Branch #1 (extension commands) IS actually dispatched
correctly when text comes via the `pi.on("input", ...)` hook, which
runs even when `expandPromptTemplates: false`. So bare extension
commands like `/flightdeck` work; skill commands `/skill:foo` and
prompt templates do NOT.

The proper fix is in pi-mono (out of vstack's repo). What we CAN do
on this branch:

1. Document the limitation prominently in
   `pi-extensions/pi-session-bridge/README.md`. Spell out:
   - Bare extension commands (`/flightdeck`, `/bridge:ping`, etc.) DO
     dispatch via `pi-bridge send`.
   - Skill commands (`/skill:foo args`) do NOT dispatch — they arrive
     as raw user text to the LLM.
   - Prompt templates do NOT expand.
   - The fix requires an upstream change to
     `@earendil-works/pi-coding-agent`'s `sendUserMessage` to accept
     an `expandPromptTemplates` option.

2. Add a note in `session-bridge.ts:440` (above the
   `pi.sendUserMessage(...)` call) referencing the limitation and
   pointing to vstack#10.

3. Add a workaround helper that pre-expands `/skill:` commands client-
   side before delivering them: read the skill file from
   `~/.pi/agent/skills/<name>/SKILL.md` (or wherever pi resolves
   skills from), inline its content, then send the expanded text via
   `sendUserMessage`. This is a partial fix — extension commands still
   work via the `input` event branch, and skill commands now get
   expanded by the bridge before delivery. Prompt templates remain
   broken until upstream lands the fix.

   The skill-expansion logic lives in pi-mono's `_expandSkillCommand`;
   we can mirror its behavior in pi-session-bridge.

4. Mention the upstream limitation in the
   `pi-extensions/pi-flightdeck/README.md` "Known limitations" section
   (or create one), referencing vstack#10.

After commit: `vstack refresh -g`.

**Verify:** `pi-bridge send --pid <PID> "/flightdeck status"` → command
dispatched (works today, no change needed). `pi-bridge send --pid <PID>
"/skill:flightdeck status"` → with the new workaround, skill expansion
happens client-side and pi receives the expanded prompt text. Bare
`/clear-ai` or other prompt-template commands still return
`Unknown command` (upstream fix required) — document this.

## Process

1. Fix #8 first — small, contained, two files + README.
2. Fix #9 next — needs the pi-flightdeck handler addition. Smoke-test
   the `pasteToEditor` dispatch path in a real flightdeck cycle.
3. Fix #10 — primarily documentation + optional client-side
   skill-expansion workaround. Don't over-engineer the workaround;
   if it's invasive, just document and reference upstream.
4. One commit per issue. Each commit should include the relevant
   test additions.
5. After all three: `bun test`, `bun run typecheck`,
   `vstack refresh -g`, and run live-wake.sh --use-ts to confirm wake
   delivery now works for pi masters.
6. Send final report via pi-bridge with commit hashes + verification.

The worktree will be merge-ready after this. Parent will then close
the three issues with a comment referencing the commit(s) in the
flightdeck-ts-port branch.
