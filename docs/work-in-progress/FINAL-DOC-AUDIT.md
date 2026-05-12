# Final doc audit + punchlist application

You are a fresh pi session spawned to do the **last** step of the
flightdeck TS port: a comprehensive documentation audit AND
application of all findings. The port is otherwise complete:

- 8 scripts ported (prompt-classify, flightdeck-state,
  parallel-groups, pane-registry, pane-poll, pane-respond,
  flightdeck-daemon + daemon run_loop, lib/paths) — 181 tests pass
- 6 review rounds completed, 3 critical bugs caught and fixed
- All trampolines default to TS (commit 69344d3)
- `FLIGHTDECK_USE_TS_<NAME>=0` / `FLIGHTDECK_USE_TS=0` opt out to bash
- bash siblings remain as fallback during stable rollout

Your job is the **last** thing. After you finish, the port is done.

## Where you are

- **Worktree:** `/mnt/Tertiary/dev/vstack/flightdeck-ts-port` (your cwd)
- **Branch:** `flightdeck-ts-port`
- **Commits ahead of `main`:** ~37
- **TS port code:** `skills/flightdeck/lib/flightdeck-core/`
- **Bash sources:** `skills/flightdeck/scripts/*.bash`
- **Trampolines:** `skills/flightdeck/scripts/<name>` (default TS now)

## What to do

### Step 1 — Audit

Walk every flightdeck doc file. For each, identify staleness, errors,
and missing additions relative to the current TS-default state.

Files to audit:

- `skills/flightdeck/SKILL.md`
- `skills/flightdeck/README.md`
- `skills/flightdeck/tests/README.md`
- `skills/flightdeck/patterns/README.md`
- `skills/flightdeck/patterns/{claude-channels,conflict-detection,decision-biases,opencode-questions,pi-questions,prompt-handlers,tmux-monitoring}.md`
- `skills/flightdeck/workflows/{close-issue,handle-prompt,merge-plan,parallel-check,start,start-new,terminate,watch}.md`
- `pi-extensions/pi-flightdeck/README.md`

Cross-reference against the current state:

- The trampolines now default to TS (per commit 69344d3).
  `FLIGHTDECK_USE_TS_<NAME>=1` is no longer the opt-in form — it's
  the implicit default. `=0` is the opt-out.
- The daemon `start` action IS now ported. Earlier docs may say it
  forwards to bash; that's wrong.
- New env vars introduced during the port:
  - `FLIGHTDECK_USE_TS` / `FLIGHTDECK_USE_TS_<NAME>` (default 1 now)
  - `FD_ADAPTER_READ_TIMEOUT_SEC` (default 2, fractional honored)
  - `FD_WAKE_TEST_DELAY_MS` (test-only seam, prod no-op)
  - `--from-handoff` daemon CLI flag (internal max-lifetime handoff)
- New behavior to mention:
  - `FD_MAX_LIFETIME` self-exec in TS daemon spawns a successor and
    the daemon PID changes (Option A divergence from bash's
    in-place exec). Master/external contracts unaffected.
  - In-process `flock(2)` via bun:ffi (`src/shared/inproc-flock.ts`)
    is now used for the hot-path session-lock decisions.
  - The native `.env` fast-path with conservative shell-feature
    heuristic + bash subprocess fallback.
  - Subscribers spawn a parent-watchdog so idle streams don't orphan.
  - Adapter read failures now fall through to tmux capture (TS only;
    documented divergence from bash siblings).
- Anything in the docs that describes the OLD opt-in default
  (e.g. "FLIGHTDECK_USE_TS=1 to opt in") is now backwards.

### Step 2 — Apply

For each finding, **apply the fix directly to the doc file**. This is
not a punchlist round — it's the final pass, so write the actual
prose. Don't leave TODOs.

Constraints:
- Match the existing voice/tone of each doc file.
- Don't introduce new structure unless the existing structure is
  inadequate. Most updates should be small additions, corrections,
  or rewrites of existing sentences.
- Don't add comments like `# updated in audit ...` — just write
  the new prose.
- Be careful with the trampoline reference. The CURRENT state:
  - `scripts/<name>` is the trampoline (defaults to TS)
  - `scripts/<name>.bash` is the legacy fallback (opt out via
    `FLIGHTDECK_USE_TS_<NAME>=0`)
  - `skills/flightdeck/lib/flightdeck-core/src/bin/<name>.ts` is
    the TS implementation
  - `bun` is now a hard runtime dependency (was conditional during
    the transition)

### Step 3 — Verify

After applying all changes:
- `cd skills/flightdeck/lib/flightdeck-core && bun test` — should
  still be 181 pass / 0 fail (no test churn expected)
- `bun run typecheck` — clean
- `cd /mnt/Tertiary/dev/vstack/flightdeck-ts-port && git diff
  --stat skills/flightdeck/*.md skills/flightdeck/**/*.md
  pi-extensions/pi-flightdeck/README.md` — review the diff

### Step 4 — Commit

One commit per logical group of doc updates (e.g. SKILL.md + README.md
together; workflows together; pi-flightdeck separately). Commit
messages should reference what changed at a high level — operators
should be able to grep the log for "trampoline default flip" etc and
find the corresponding doc update.

Commit message format:
```
flightdeck-ts-port: doc audit — <area> updated for TS-default state

<short bullet list of major changes>
```

### Step 5 — Report

Send a final message via `pi-bridge send --pid <PARENT_PID>` with:
- List of doc files modified
- Commit hashes added
- Summary of major staleness corrected (e.g. "20 files mentioned
  FLIGHTDECK_USE_TS=1 as opt-in; rewrote as default")
- Any items you found ambiguous and decided NOT to change

## Constraints and rules

- Read-only audit of code; modify only docs.
- No new scripts, no test changes (unless a doc reference to a
  test was wrong and a one-line test rename clarifies the issue).
- Don't push, don't merge — stay on `flightdeck-ts-port`.
- One commit per logical group; never `git add -A`. Stage each
  doc file explicitly.
- Use `--no-gpg-sign` if signing fails.
- The CONTINUATION-HANDOFF.md and DISPATCH-*.md files in
  docs/work-in-progress/ are not user-facing docs; don't audit them
  for staleness.

## Footguns to watch for

- The `.bash` siblings under `scripts/` should remain — operators
  rely on them for opt-out. If you see docs claiming they were
  deleted, that's wrong. They stay until a separate cleanup commit
  after stable rollout.
- Some docs reference `lib/flightdeck-core/tests/parity/` test
  counts; don't hardcode counts (they drift).
- The reviewer-flagged "deferred" items from earlier rounds (async
  pane-poll, native jq replacement) ARE still deferred. Don't
  rewrite docs to claim they're done.
- The bash sibling files contain the canonical body for some
  paths (e.g. subscribers.bash is shared between bash + TS daemon).
  Don't describe them as "obsolete".

## Tools

- `read` / `write` / `edit` / `grep` / `find` for files
- `bash` for verification (`bun test`, `bun run typecheck`,
  `git status`, `git diff`)
- `pi-bridge send --pid <PARENT>` for the final report

## After you finish

This is the last step. Send your report, then stop. The parent will
verify the diff, ack you, and the worktree is ready for merge after
external sign-off.
