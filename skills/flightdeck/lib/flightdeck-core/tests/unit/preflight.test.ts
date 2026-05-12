// Unit test: preflight emits clear error + exit 127 when a required
// dependency is missing.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = import.meta.dir;
const PROBE = resolve(HERE, "../../src/shared/preflight.ts");

function sandboxPathWithOnly(bins: string[]): string {
	const d = mkdtempSync(join(tmpdir(), "fd-preflight-"));
	mkdirSync(join(d, "bin"));
	for (const bin of bins) {
		const r = spawnSync("command", ["-v", bin], { encoding: "utf8", shell: "/bin/bash" });
		const real = (r.stdout ?? "").trim();
		if (!real) continue;
		try { symlinkSync(real, join(d, "bin", bin)); } catch { /* ignore */ }
	}
	return join(d, "bin");
}

function runProbe(env: Record<string, string>, expr?: string): { status: number | null; stderr: string } {
	const body = expr ?? `import { preflightDeps } from "${PROBE}"; preflightDeps();`;
	const r = spawnSync("bun", ["-e", body], { encoding: "utf8", env });
	return { status: r.status, stderr: r.stderr ?? "" };
}

describe("preflightDeps", () => {
	test("passes when jq+flock+bash on PATH", () => {
		// Inherit a normal PATH — system has these.
		const r = runProbe({ ...process.env as Record<string, string> });
		expect(r.status).toBe(0);
	});

	test("fails 2 with clear message when PATH lacks deps", () => {
		// Sandbox PATH: include bun (else the child can't start) but
		// exclude the rest. Exit 2 matches the bash daemon's
		// _check_deps_inline contract.
		const path = sandboxPathWithOnly(["bun"]);
		const r = runProbe({ PATH: path, HOME: process.env.HOME ?? "" });
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("required dependency missing");
	});

	test("STATE_ONLY skips tmux/awk/sha256sum checks", () => {
		// Sandbox PATH with only jq + flock + bash + bun. STATE_ONLY
		// should pass; FULL would fail (tmux/awk/sha256sum absent).
		const path = sandboxPathWithOnly(["bun", "jq", "flock", "bash"]);
		const stateOnlyExpr = `import { preflightDeps, STATE_ONLY_REQUIRED } from "${PROBE}"; preflightDeps(STATE_ONLY_REQUIRED);`;
		const r = runProbe({ PATH: path, HOME: process.env.HOME ?? "" }, stateOnlyExpr);
		expect(r.status).toBe(0);
	});
});
