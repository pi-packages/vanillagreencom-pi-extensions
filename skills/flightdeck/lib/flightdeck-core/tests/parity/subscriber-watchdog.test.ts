// Regression test: idle subscribers exit on parent death (round-4 #5).
//
// Pre-fix: cc/pi/cx subscribers block in `tail -F` / `pi-bridge stream` /
// `cx_bridge_run stream` waiting on data. The inner `while read`
// parent_pid check only fires on each new line; a quiet stream
// (transcript with no new assistant turns for minutes) means the
// check never runs and the subscriber + tail/jq pipeline children
// orphan on parent death.
//
// Fix: external watchdog polls kill -0 parent_pid every 5s; on death
// SIGTERM the subscriber's pgroup.

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBSCRIBERS_BASH = resolve(HERE, "../../../../scripts/lib/subscribers.bash");

function sleep(ms: number): Promise<void> { return new Promise((res) => setTimeout(res, ms)); }
function pidAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

describe("subscriber watchdog (round-4 #5)", () => {
	test("cc subscriber + pipeline children exit when parent dies (idle stream)", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "fd-sub-wd-"));
		const sessionLock = join(stateDir, "session.lock");
		const wakeLog = join(stateDir, "wake-events.log");
		const log = join(stateDir, "daemon.log");
		const transcript = join(stateDir, "transcript.jsonl");
		// Touch the transcript so cc subscriber doesn't sit in the
		// 'wait for transcript' inner loop.
		writeFileSync(transcript, "");

		try {
			// Fake parent that just sleeps. The watchdog polls this pid.
			const fakeParent = spawn("sleep", ["60"], { stdio: "ignore" });
			const parentPid = fakeParent.pid!;

			// Spawn the subscriber.
			const env: NodeJS.ProcessEnv = {
				...(process.env as NodeJS.ProcessEnv),
				FD_STATE_DIR: stateDir,
				SESSION_LOCK: sessionLock,
				WAKE_EVENTS_LOG: wakeLog,
				LOG: log,
				CLASSIFIER: "",
				CC_LAST_ASSISTANT_JQ: ".message.content // .content // []",
			};
			const sub = spawn("bash", [SUBSCRIBERS_BASH, "cc", "%999", transcript, String(parentPid)], { env, stdio: "ignore", detached: true });
			const subPid = sub.pid!;

			// Give the subscriber a moment to start its tail/jq pipeline.
			await sleep(2000);
			expect(pidAlive(subPid)).toBe(true);

			// Kill the fake parent. Subscriber's watchdog polls every
			// 5s; allow up to 7s for the kill to propagate.
			fakeParent.kill("SIGKILL");
			let deadline = Date.now() + 8000;
			while (Date.now() < deadline) {
				if (!pidAlive(subPid)) break;
				await sleep(200);
			}
			expect(pidAlive(subPid)).toBe(false);

			// No tail/jq orphans should remain matching our transcript path.
			const { execSync } = await import("node:child_process");
			let orphans = "";
			try { orphans = execSync(`pgrep -f "${transcript}"`, { encoding: "utf8" }).trim(); } catch { orphans = ""; }
			expect(orphans).toBe("");
		} finally {
			if (stateDir) rmSync(stateDir, { recursive: true, force: true });
		}
	}, 15000);
});
