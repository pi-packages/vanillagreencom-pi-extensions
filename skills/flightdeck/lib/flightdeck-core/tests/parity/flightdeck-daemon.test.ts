// Parity test: flightdeck-daemon (bash) vs flightdeck-daemon (TS) — limited
// to the CLI subcommands the TS port currently implements directly.
// `start` is forwarded to bash and not under parity here.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../../../../scripts/flightdeck-daemon");

if (!process.env.TMUX) {
	test.skip("flightdeck-daemon parity requires tmux", () => undefined);
}

function run(useTs: boolean, args: string[]): { stdout: string; stderr: string; status: number | null } {
	const env: Record<string, string> = { ...(process.env as Record<string, string>) };
	if (useTs) env.FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON = "1";
	else delete env.FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON;
	delete env.FLIGHTDECK_USE_TS;
	const r = spawnSync(SCRIPT, args, { encoding: "utf8", env });
	return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

const SESSION = process.env.TMUX_PARITY_SESSION ?? sessionName();

function sessionName(): string {
	const r = spawnSync("tmux", ["display-message", "-p", "#S"], { encoding: "utf8" });
	return (r.stdout ?? "").trim();
}

describe("flightdeck-daemon parity (no-daemon paths)", () => {
	test("status: no daemon → exit 1 with matching message", () => {
		// Both implementations expect a session that exists but has no
		// daemon running. We use a non-existent session name so the
		// pidfile path is also non-existent.
		const a = run(false, ["status", "--session", "NO-SUCH-SESSION"]);
		const b = run(true, ["status", "--session", "NO-SUCH-SESSION"]);
		expect(b.status).toBe(a.status);
		expect(b.stdout).toBe(a.stdout);
	});

	test("find-window: unresolved session → exit 1", () => {
		const a = run(false, ["find-window", "--session", "NO-SUCH-SESSION"]);
		const b = run(true, ["find-window", "--session", "NO-SUCH-SESSION"]);
		expect(b.status).toBe(a.status);
		expect(b.stdout).toBe(a.stdout);
		expect(a.status).toBe(1);
	});

	test("health: no daemon → exit 1 with same line", () => {
		const a = run(false, ["health", "--session", "NO-SUCH-SESSION"]);
		const b = run(true, ["health", "--session", "NO-SUCH-SESSION"]);
		expect(b.status).toBe(a.status);
		expect(b.stdout).toBe(a.stdout);
	});

	test("stop: no daemon → exit 1", () => {
		const a = run(false, ["stop", "--session", "NO-SUCH-SESSION"]);
		const b = run(true, ["stop", "--session", "NO-SUCH-SESSION"]);
		expect(b.status).toBe(a.status);
		expect(b.stdout).toBe(a.stdout);
		expect(a.status).toBe(1);
	});

	test("missing --session → exit 2", () => {
		const a = run(false, ["status"]);
		const b = run(true, ["status"]);
		expect(b.status).toBe(a.status);
		expect(a.status).toBe(2);
	});

	test("unknown action → exit 2", () => {
		const a = run(false, ["bogus", "--session", SESSION]);
		const b = run(true, ["bogus", "--session", SESSION]);
		expect(b.status).toBe(a.status);
		expect(a.status).toBe(2);
	});

	test("ack --session s999999 → no-daemon path without tmux preflight", () => {
		// Session-key form (sN). Key resolution doesn't need tmux. Both
		// implementations should return cleanly with no-daemon status
		// even if tmux isn't on PATH. Drain returns empty stdout for a
		// non-existent events file (under the session lock).
		const a = run(false, ["ack", "--session", "s999999"]);
		const b = run(true, ["ack", "--session", "s999999"]);
		expect(b.status).toBe(a.status);
		expect(b.stdout).toBe(a.stdout);
	});
});

const HAS_BASH_AND_BUN = (() => {
	const b = spawnSync("bash", ["--version"], { encoding: "utf8" });
	const u = spawnSync("bun", ["--version"], { encoding: "utf8" });
	return b.status === 0 && u.status === 0;
})();

describe("flightdeck-daemon preflight (tmux gating)", () => {
	if (!HAS_BASH_AND_BUN) return;

	function sandboxPathWithout(exclude: string[]): string {
		const { mkdtempSync, mkdirSync, symlinkSync, readdirSync } = require("node:fs") as typeof import("node:fs");
		const { tmpdir } = require("node:os") as typeof import("node:os");
		const { join } = require("node:path") as typeof import("node:path");
		const dir = mkdtempSync(join(tmpdir(), "fd-preflight-"));
		const binDir = join(dir, "bin");
		mkdirSync(binDir);
		for (const pathDir of (process.env.PATH ?? "").split(":")) {
			if (!pathDir) continue;
			let entries: string[];
			try { entries = readdirSync(pathDir); } catch { continue; }
			for (const entry of entries) {
				if (exclude.includes(entry)) continue;
				const dst = join(binDir, entry);
				try { symlinkSync(join(pathDir, entry), dst); } catch { /* skip dupes */ }
			}
		}
		return binDir;
	}

	test("status --session <name> with tmux missing → exit 2", () => {
		const path = sandboxPathWithout(["tmux"]);
		const env = { ...(process.env as Record<string, string>), PATH: path, FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON: "1" } as Record<string, string>;
		delete (env as Record<string, string | undefined>).FLIGHTDECK_USE_TS;
		delete (env as Record<string, string | undefined>).TMUX;
		const r = spawnSync(SCRIPT, ["status", "--session", "some-name"], { encoding: "utf8", env });
		expect(r.status).toBe(2);
	});

	test("ack --session s999999 with tmux missing → not gated on tmux", () => {
		// Session-key form (sN) means we don't need tmux. Preflight
		// should pass and the ack should succeed (empty output, exit 0).
		const path = sandboxPathWithout(["tmux"]);
		const env = { ...(process.env as Record<string, string>), PATH: path, FLIGHTDECK_USE_TS_FLIGHTDECK_DAEMON: "1" } as Record<string, string>;
		delete (env as Record<string, string | undefined>).FLIGHTDECK_USE_TS;
		delete (env as Record<string, string | undefined>).TMUX;
		const r = spawnSync(SCRIPT, ["ack", "--session", "s999999"], { encoding: "utf8", env });
		expect(r.status).not.toBe(2);
	});
});
