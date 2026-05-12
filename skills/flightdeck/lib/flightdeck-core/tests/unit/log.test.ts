// Unit test: daemonLog/daemonWarn append timestamped lines to the log
// file with the bash daemon's `<iso> [<tag>] <msg>\n` format.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { daemonLog, daemonWarn } from "../../src/daemon/log.ts";

let dir = "";
let logFile = "";

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fd-log-")); logFile = join(dir, "daemon.log"); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("daemonLog/daemonWarn", () => {
	test("appends timestamped line to log file", () => {
		daemonLog(logFile, "test", "hello");
		const text = readFileSync(logFile, "utf8");
		expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[test\] hello\n$/);
	});

	test("multiple appends preserve order", () => {
		daemonLog(logFile, "a", "first");
		daemonLog(logFile, "b", "second");
		daemonWarn(logFile, "c", "third");
		const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("[a] first");
		expect(lines[1]).toContain("[b] second");
		expect(lines[2]).toContain("[c] third");
	});

	test("missing log file directory: silently best-effort (no throw)", () => {
		// Bash daemon swallows append errors via 2>/dev/null implicitly
		// when run with set -e off in those code paths. TS port mirrors
		// that.
		expect(() => daemonLog("/nonexistent/dir/log.txt", "x", "msg")).not.toThrow();
	});
});
