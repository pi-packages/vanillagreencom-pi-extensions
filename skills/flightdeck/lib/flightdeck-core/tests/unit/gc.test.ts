// Unit test: gcOrphanState removes per-session daemon files when the
// session is dead and the pid file doesn't point to a live pid; and
// sweeps subscriber pid files whose recorded pid is dead.
//
// Live-session detection runs through tmux. The unit test stubs out
// tmux interactions by forcing all keys to be considered "dead" (no
// live sessions) and only varying the pid file contents.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gcOrphanState } from "../../src/daemon/gc.ts";

let dir = "";

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fd-gc-")); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function seed(name: string, content = ""): string {
	const p = join(dir, name);
	writeFileSync(p, content);
	return p;
}

describe("gcOrphanState", () => {
	test("removes orphan daemon files when session is gone and pid is dead", () => {
		// pid file with a guaranteed-dead pid (1 is init, alive — use a
		// large number unlikely to exist).
		const pidFile = seed("fd-daemon-s99999.pid", "999999999\n");
		const lockFile = seed("fd-daemon-s99999.lock");
		const logFile = seed("fd-daemon-s99999.log");
		const heartbeat = seed("fd-daemon-s99999.heartbeat");
		const busy = seed("fd-master-s99999.busy");
		const wakeLog = seed("fd-wake-events-s99999.log");
		// Unrelated file should survive.
		const unrelated = seed("unrelated.txt", "x");

		let cleanedKey = "";
		gcOrphanState({
			stateDir: dir,
			lockedCleanupForKey: (k) => { cleanedKey = k; },
			log: () => { /* ignore */ },
		});

		expect(cleanedKey).toBe("s99999");
		expect(existsSync(pidFile)).toBe(false);
		expect(existsSync(lockFile)).toBe(false);
		expect(existsSync(logFile)).toBe(false);
		expect(existsSync(heartbeat)).toBe(false);
		expect(existsSync(busy)).toBe(false);
		expect(existsSync(wakeLog)).toBe(false);
		expect(existsSync(unrelated)).toBe(true);
	});

	test("preserves daemon files when pid is alive (this process)", () => {
		const myPid = String(process.pid);
		const pidFile = seed("fd-daemon-s88888.pid", `${myPid}\n`);
		const lockFile = seed("fd-daemon-s88888.lock");

		gcOrphanState({
			stateDir: dir,
			lockedCleanupForKey: () => { throw new Error("must not cleanup live session"); },
			log: () => { /* ignore */ },
		});

		expect(existsSync(pidFile)).toBe(true);
		expect(existsSync(lockFile)).toBe(true);
	});

	test("sweeps subscriber pid files with dead pids", () => {
		const dead = seed("fd-subscriber-s1-pane42.pid", "999999999\n");
		const ccDead = seed("fd-cc-subscriber-s1-pane42.pid", "999999998\n");
		const live = seed("fd-pi-subscriber-s1-pane42.pid", `${process.pid}\n`);
		const cxDead = seed("fd-cx-subscriber-s1-pane42.pid", "888888888\n");

		gcOrphanState({
			stateDir: dir,
			lockedCleanupForKey: () => { /* no-op */ },
			log: () => { /* ignore */ },
		});

		expect(existsSync(dead)).toBe(false);
		expect(existsSync(ccDead)).toBe(false);
		expect(existsSync(cxDead)).toBe(false);
		expect(existsSync(live)).toBe(true);
	});

	test("never touches .session-lock files (must keep inode stable)", () => {
		const sessionLock = seed("fd-daemon-s77777.session-lock");
		const pidFile = seed("fd-daemon-s77777.pid", "999999999\n");

		gcOrphanState({
			stateDir: dir,
			lockedCleanupForKey: () => { /* no-op */ },
			log: () => { /* ignore */ },
		});

		expect(existsSync(pidFile)).toBe(false);
		expect(existsSync(sessionLock)).toBe(true);
	});
});
