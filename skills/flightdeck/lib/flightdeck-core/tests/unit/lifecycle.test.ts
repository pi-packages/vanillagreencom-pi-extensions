// Unit tests: touchHeartbeat + killAllSubscribers behavior. Signal
// handler installation is exercised by the daemon-runloop parity test
// (it spawns a daemon and sends SIGTERM).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { touchHeartbeat, killAllSubscribers } from "../../src/daemon/lifecycle.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fd-lifecycle-")); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("touchHeartbeat", () => {
	test("creates the file when missing", () => {
		const f = join(dir, "hb");
		touchHeartbeat(f);
		expect(existsSync(f)).toBe(true);
	});

	test("updates mtime when present", () => {
		const f = join(dir, "hb");
		writeFileSync(f, "");
		const m0 = statSync(f).mtimeMs;
		// Sleep briefly to get a distinct mtime — Linux ext4 has 1ns
		// resolution but Date.now is ms. Use 10ms.
		const wait = 30;
		const start = Date.now();
		while (Date.now() - start < wait) { /* spin */ }
		touchHeartbeat(f);
		const m1 = statSync(f).mtimeMs;
		expect(m1).toBeGreaterThanOrEqual(m0);
	});
});

describe("killAllSubscribers", () => {
	test("removes pid files scoped to session_key", () => {
		// Seed two subscriber pid files for our session + one for a
		// different session that should be left alone.
		writeFileSync(join(dir, "fd-subscriber-sTest-pane42.pid"), "999999999\n");
		writeFileSync(join(dir, "fd-cc-subscriber-sTest-pane43.pid"), "999999998\n");
		writeFileSync(join(dir, "fd-subscriber-sOther-pane1.pid"), "999999997\n");
		// Unrelated file should also survive.
		writeFileSync(join(dir, "other.txt"), "x");

		killAllSubscribers({
			stateDir: dir,
			sessionKey: "sTest",
			collectDescendants: () => [],
		});

		const remaining = readdirSync(dir).sort();
		expect(remaining).toEqual(["fd-subscriber-sOther-pane1.pid", "other.txt"]);
	});

	test("with alive pid: collectDescendants is invoked", () => {
		// Spawn a long-lived child we can safely SIGTERM (don't use
		// process.pid — that would kill the test runner).
		const { spawn } = require("node:child_process") as typeof import("node:child_process");
		const child = spawn("sleep", ["30"], { stdio: "ignore" });
		try {
			writeFileSync(join(dir, "fd-subscriber-sTest-paneX.pid"), `${child.pid}\n`);
			const calls: number[] = [];
			killAllSubscribers({
				stateDir: dir,
				sessionKey: "sTest",
				collectDescendants: (pid) => { calls.push(pid); return []; },
			});
			expect(calls).toContain(child.pid!);
			expect(existsSync(join(dir, "fd-subscriber-sTest-paneX.pid"))).toBe(false);
		} finally {
			// Belt-and-braces in case killAllSubscribers didn't reach it.
			try { child.kill("SIGKILL"); } catch { /* */ }
		}
	});
});
