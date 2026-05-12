// Unit tests for subscriber spawn helpers + drain helper.
// These tests don't bring up a real subscriber loop — they verify the
// spawn pid-file behavior and the drain helper.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drainOcWakeEvents } from "../../src/daemon/subscribers/drain.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fd-sub-")); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("drainOcWakeEvents", () => {
	test("missing file → empty lines", () => {
		const r = drainOcWakeEvents(join(dir, "session.lock"), join(dir, "wake-events.log"));
		expect(r.lines).toEqual([]);
		expect(r.status).toBe(0);
	});

	test("drains JSONL + removes the source file under flock", () => {
		const log = join(dir, "wake-events.log");
		const rows = [
			JSON.stringify({ pane_id: "%101", hash: "h1", classifier_tag: "merge-now" }),
			JSON.stringify({ pane_id: "%102", hash: "h2", classifier_tag: "bell" }),
		];
		writeFileSync(log, rows.join("\n") + "\n");
		const r = drainOcWakeEvents(join(dir, "session.lock"), log);
		expect(r.lines.length).toBe(2);
		expect(JSON.parse(r.lines[0]!).pane_id).toBe("%101");
		expect(JSON.parse(r.lines[1]!).pane_id).toBe("%102");
		expect(existsSync(log)).toBe(false);
	});

	test("folds in stranded .draining.<pid> from a dead drain", () => {
		const log = join(dir, "wake-events.log");
		const stranded = `${log}.draining.999999999`;
		writeFileSync(stranded, JSON.stringify({ pane_id: "%99", hash: "stranded" }) + "\n");
		writeFileSync(log, JSON.stringify({ pane_id: "%100", hash: "live" }) + "\n");
		const r = drainOcWakeEvents(join(dir, "session.lock"), log);
		expect(r.lines.length).toBe(2);
		expect(r.lines.some((l) => l.includes("stranded"))).toBe(true);
		expect(r.lines.some((l) => l.includes("live"))).toBe(true);
		expect(existsSync(stranded)).toBe(false);
	});
});
