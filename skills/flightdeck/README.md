# Flightdeck

Hands-off orchestration for parallel AI dev sessions. When you spawn multiple coding agents to work on different issues at the same time, flightdeck becomes the supervisor that watches all of them, answers their prompts with sensible defaults, plans the merge order around file conflicts, and only interrupts you when something genuinely needs a human.

> Agents reading this: you want `SKILL.md` instead.

## What problem it solves

Running one agent at a time is fine. Running five at once is chaos — each one keeps stopping to ask *"should I clean this up?"* or *"the bot review timed out, abort?"*, and the order you merge them in turns into a guessing game. Flightdeck handles the supervisory layer so you can spawn a whole cycle's worth of work and walk away.

It activates only inside tmux and only when you ask for it (`flightdeck start` from your harness). Outside tmux it's a no-op.

## How it works

Flightdeck spawns each agent into its own tmux window via `open-terminal`, then watches all of them in parallel. For each agent it picks the cleanest available communication channel:

| Harness     | How flightdeck talks to that agent |
|-------------|------------------------------------|
| Claude Code | Localhost HTTP channel server (MCP push) + transcript tailing |
| OpenCode    | Direct HTTP session API |
| Pi          | Unix-socket bridge speaking JSON line by line |
| Codex       | JSON-RPC over WebSocket against `codex app-server` |

When a channel isn't available, flightdeck falls back to the legacy path: reading the agent's terminal text via tmux and typing replies as keystrokes. It works, but it's fragile — native channels are always preferred.

A small background daemon polls the agent panes a few times a second, detects when an agent has something to ask, classifies the prompt against a library of known shapes, and wakes the master agent. The master either auto-answers (most prompts have a learned default) or pauses for the human.

When every tracked issue is merged, aborted, or otherwise terminal, flightdeck writes a session summary — including any new issues the agents created along the way and a recommendation about what to tackle next — and hands control back.

## Activation and termination

- **Activates** when you run `flightdeck start` from your harness inside tmux. Single issue or many — flightdeck supervises whatever you spawn.
- **Pauses** for you on: scope creep that wants reverting, force-merging against a real content conflict, an issue abort, a `main` mutation that needs human OK, or a novel prompt shape no rule covers. Set `paused_for_user` in state and stops polling. Resume by running `watch` again.
- **Terminates** automatically when every tracked issue is in a terminal state for two consecutive poll cycles. Writes a summary, archives the state file, hands control back to your usual orchestration view.

## Settings worth knowing

Most users never touch these. The ones that occasionally matter:

| Variable | What it does |
|----------|--------------|
| `FLIGHTDECK_AUTO_MERGE` | Set to `0` to require a human OK on every merge instead of auto-handling the obvious case. Useful for compliance-sensitive repos or big-blast-radius PRs. |
| `FLIGHTDECK_FORCE_MERGE_AFTER_SECS` | How long flightdeck waits before force-merging a PR that's approved + green but stuck in GitHub's `UNKNOWN` merge state (default 4 minutes). |
| `FLIGHTDECK_LAUNCH_MODEL` / `FLIGHTDECK_LAUNCH_EFFORT` | Default model + thinking level for spawned agents when the user doesn't pass them explicitly. |
| `FLIGHTDECK_STATE_DIR` | Where flightdeck writes its session state file inside the project. Defaults to `tmp/`. |

The background daemon has its own knobs (timing, cache TTLs, etc.) under `FD_*` env vars. Defaults are fine for normal use — see `SKILL.md § Configuration` if you're tuning. Daemon-private files live outside your project under `~/.cache` / `XDG_RUNTIME_DIR` so they don't show up in commits.

## Scripts

You don't run any of these by hand in normal use — the skill calls them. Listed so you know what's there if you're debugging.

| Script | What it does |
|--------|--------------|
| `open-terminal` | Launches a new tmux window with the chosen harness running on the chosen issue worktree. |
| `flightdeck-state` | Reads/writes the session's master state file. |
| `flightdeck-daemon` | Background poller. Wakes the master when an agent needs attention. |
| `pane-registry` | Tracks which issue lives in which tmux pane and how to talk to its agent. |
| `pane-poll` | Reads an agent's current state (via native channel where possible). |
| `pane-respond` | Sends a reply or option pick into an agent. |
| `prompt-classify` | Pattern-matches an agent's last output against known prompt shapes. |
| `pr-conflict-graph` | Builds a file-overlap graph between PRs so flightdeck can pick a safe merge order. |
| `parallel-groups` | Reads parallel-execution groups for the current planning cycle. |
| `codex-app-server-spawn` / `-stop` | Brings up / tears down the shared Codex bridge server for codex-mode sessions. |
| `pane-clear-bell` | Clears the tmux bell flag without screen flicker after answering. |

## Patterns

The `patterns/` directory documents the decisions the master agent makes — *when* to skip a bot review, *how* to handle a rebase prompt, *when* to force-merge — so future maintainers (human or AI) understand the reasoning, not just the code.

| Pattern | What it covers |
|---------|----------------|
| `tmux-monitoring.md` | How flightdeck reads panes and the per-harness native channels |
| `prompt-handlers.md` | The library of prompt shapes and how each gets answered |
| `conflict-detection.md` | How merge order is planned around file-level conflicts |
| `decision-biases.md` | Judgment heuristics: smaller-first, scope creep detection, rule of three |
| `claude-channels.md` | Claude Code's MCP channel adapter |
| `opencode-questions.md` | OpenCode's structured question API |
| `pi-questions.md` | Pi's structured question API |

## Pi dashboard (optional)

If your master agent runs in Pi, install the [`pi-flightdeck`](../../pi-extensions/pi-flightdeck/README.md) extension for a live mission-control overlay — pause banner, persistent dashboard above the editor, `/flightdeck` popup with six tabs. It's read-only; the underlying skill works identically with or without it.

```
vstack add vanillagreencom/vstack --pi-extension pi-flightdeck --harness pi -y
```

## Installation

```
cd /path/to/your/project
vstack add vanillagreencom/vstack --skill flightdeck -y
```

Pulls in required dependencies (`github`, `linear`, `project-management`). System requirements: `bash` 4+, `tmux` 3.x, `jq`, `gh`, `flock`. Mac users: install GNU coreutils for `sha256sum` and GNU date.

## Debugging

State file lives at `tmp/flightdeck-state-<TMUX_SESSION_NAME>.json` — inspect with `jq`:

```
.agents/skills/flightdeck/scripts/flightdeck-state get '.' | jq
```

If flightdeck seems stuck on a prompt, the usual cause is a novel prompt shape the classifier doesn't recognize. The skill escalates these as `generic-multi-choice` for human review. Add a sentinel to `prompt-classify` if it's a shape worth automating.

## Tests

`tests/live-wake.sh` runs the full daemon wake path against a real Pi master — useful when you've changed the daemon or pane-poll code paths. Takes ~2 minutes, requires tmux + a real `pi` binary. `tests/live-wake.sh --no-tmux` is a quick shape-check that runs in CI.

See `tests/README.md` for setup and cleanup.

## Out of scope

- Flightdeck does not abort issues for you — only you can.
- Flightdeck does not respawn dead panes.
- Flightdeck operates within one tmux session at a time. Multiple sessions are independent.
- Flightdeck does not bypass the parallel-safety check that orchestration runs before spawn. If that check says no, flightdeck doesn't override.
