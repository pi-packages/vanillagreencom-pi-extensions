// Port of scripts/flightdeck-daemon.bash::wake_payload_for_harness.
//
// Build the wake message payload for a given master harness. Each TUI
// parses commands with its own grammar prefix; sending the slash form
// to codex (which uses `$` for commands) or to a Pi session via the
// bridge (slash/skill expansion is bypassed) means the master LLM only
// sees raw text it has to interpret rather than a real command
// invocation. Default keeps the legacy slash form for unspecified
// harnesses so existing claude/opencode behavior is unchanged.
//
// Pi-specific routing (issue #9 + workaround for #10): pi-bridge
// bypasses pi's `_expandSkillCommand` resolver, so the legacy
// `/skill:flightdeck watch --from-daemon` payload was rejected as
// 'Unknown command' when delivered via `pi-bridge send`. The bare
// `/flightdeck` extension command IS dispatched by pi-bridge because
// it routes through the `pi.on("input", ...)` hook which fires even
// when `expandPromptTemplates: false`. The pi-flightdeck extension
// command handler parses `watch ...` args and re-dispatches via
// `ctx.ui.pasteToEditor("/skill:flightdeck watch ...\n")` to hit the
// full slash-resolver path.

export function wakePayloadForHarness(harness: string | undefined | null): string {
	switch ((harness ?? "").toLowerCase()) {
		case "codex":
			return "$flightdeck watch --from-daemon";
		case "pi":
			return "/flightdeck watch --from-daemon";
		default:
			return "/flightdeck watch --from-daemon";
	}
}
