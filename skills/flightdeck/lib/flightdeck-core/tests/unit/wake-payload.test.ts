// Unit test: wakePayloadForHarness matches the bash daemon's wake
// payload selector byte-for-byte.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { wakePayloadForHarness } from "../../src/daemon/wake-payload.ts";

function bashWakePayload(harness: string): string {
	// Pure-function port of the bash daemon's wake_payload_for_harness
	// (issue #9: pi now uses the bare /flightdeck extension command
	// instead of /skill:flightdeck so pi-bridge's sendUserMessage —
	// which bypasses _expandSkillCommand — still routes the wake
	// through the pi.on('input') extension-command branch).
	const script = [
		"wake_payload_for_harness() {",
		"  case \"${1:-}\" in",
		"    codex) printf '%s' '$flightdeck watch --from-daemon' ;;",
		"    pi)    printf '%s' '/flightdeck watch --from-daemon' ;;",
		"    *)     printf '%s' '/flightdeck watch --from-daemon' ;;",
		"  esac",
		"}",
		"wake_payload_for_harness \"$1\"",
	].join("\n");
	const r = spawnSync("bash", ["-c", script, "_", harness], { encoding: "utf8" });
	return r.stdout ?? "";
}

describe("wakePayloadForHarness parity", () => {
	for (const h of ["codex", "pi", "claude", "opencode", "", "unknown"]) {
		test(`harness=${h || "(empty)"}`, () => {
			expect(wakePayloadForHarness(h)).toBe(bashWakePayload(h));
		});
	}

	test("case-insensitive", () => {
		expect(wakePayloadForHarness("CODEX")).toBe("$flightdeck watch --from-daemon");
		expect(wakePayloadForHarness("Pi")).toBe("/flightdeck watch --from-daemon");
	});

	test("pi payload uses the bare /flightdeck extension command (issue #9)", () => {
		// Workaround for vstack#10: pi-bridge sendUserMessage hard-
		// codes expandPromptTemplates: false so /skill:flightdeck
		// arrives as raw text. The bare /flightdeck routes via
		// pi.on('input') → _tryExecuteExtensionCommand, which
		// pi-bridge does call.
		expect(wakePayloadForHarness("pi")).toBe("/flightdeck watch --from-daemon");
		expect(wakePayloadForHarness("pi")).not.toContain("/skill:");
	});
});
