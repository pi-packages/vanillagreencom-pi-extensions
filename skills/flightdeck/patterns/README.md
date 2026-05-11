# Flightdeck patterns

Behaviors and judgment calls the master agent encodes when supervising spawned panes. Each pattern doc captures a real lesson from running multi-issue parallel sessions — what shape of prompt to expect, what answer is usually right, and where the edge cases are.

Workflows in `../workflows/` invoke these patterns at decision points; scripts in `../scripts/` enforce some of them in code. Agents reading `SKILL.md` are pointed here whenever the matching prompt class appears.

| Pattern | What it covers |
|---------|----------------|
| [`tmux-monitoring.md`](tmux-monitoring.md) | How flightdeck reads panes — pane targeting, bell handling, the per-harness native channels (Claude Code MCP, OpenCode HTTP, Pi bridge, Codex WebSocket) and when each falls back to plain terminal scraping. |
| [`prompt-handlers.md`](prompt-handlers.md) | The library of prompt shapes the supervisor recognizes and the default answer for each — cleanup scope, combine-guidance-with-pick, bot-review skip, rebase template, parent-vs-related, verify-don't-trust. |
| [`conflict-detection.md`](conflict-detection.md) | How merge order is planned around file-level conflicts; defer-ci semantics; the predicate that decides when force-merging is safe. |
| [`decision-biases.md`](decision-biases.md) | Judgment heuristics — smaller-PR-first, scope-creep detection, rule of three for shared helpers, expansion bias, merge-order tiebreakers. |
| [`claude-channels.md`](claude-channels.md) | The opt-in Claude Code adapter that pushes events into the agent via an MCP channel webhook + transcript tail. |
| [`opencode-questions.md`](opencode-questions.md) | How OpenCode's structured question API is routed through `pane-respond` and the off-list label policy. |
| [`pi-questions.md`](pi-questions.md) | How Pi's structured question API is routed via the bridge and when free-form custom text is allowed. |
