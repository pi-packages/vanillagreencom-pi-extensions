// Unit test: loadDotEnvIntoProcess matches `set -a; source .env` bash
// behavior — including ${VAR:-fallback} and $VAR expansion. The old
// hand-rolled parser ignored those and silently diverged from bash.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { loadDotEnvIntoProcess } from "../../src/shared/project.ts";

function getEnv(key: string): string | undefined {
	return (process.env as Record<string, string | undefined>)[key];
}

function setEnv(key: string, value: string): void {
	(process.env as Record<string, string>)[key] = value;
}

function delEnv(key: string): void {
	delete (process.env as Record<string, string | undefined>)[key];
}

let tmp = "";
const savedEnv: Record<string, string | undefined> = {};

function snap(...keys: string[]): void {
	for (const k of keys) savedEnv[k] = process.env[k];
}
function restore(): void {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	for (const k of Object.keys(savedEnv)) delete savedEnv[k];
}

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "fd-dotenv-")); });
afterEach(() => {
	restore();
	if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("loadDotEnvIntoProcess parity with bash source", () => {
	test("plain KEY=VALUE imports", () => {
		snap("FD_TEST_PLAIN");
		delEnv("FD_TEST_PLAIN");
		writeFileSync(join(tmp, ".env"), "FD_TEST_PLAIN=hello\n");
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("FD_TEST_PLAIN")).toBe("hello");
	});

	test("${VAR:-fallback} expansion", () => {
		snap("FD_TEST_FALLBACK", "FD_TEST_PRESET");
		delEnv("FD_TEST_FALLBACK");
		delEnv("FD_TEST_PRESET");
		writeFileSync(join(tmp, ".env"), `FD_TEST_FALLBACK=\${FD_NOT_SET:-default-value}\n`);
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("FD_TEST_FALLBACK")).toBe("default-value");
	});

	test("$VAR substitution from outer env", () => {
		snap("FD_TEST_SUBST");
		delEnv("FD_TEST_SUBST");
		setEnv("FD_TEST_OUTER", "outer");
		writeFileSync(join(tmp, ".env"), `FD_TEST_SUBST=prefix-\${FD_TEST_OUTER}-suffix\n`);
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("FD_TEST_SUBST")).toBe("prefix-outer-suffix");
		delEnv("FD_TEST_OUTER");
	});

	test("export KEY=VALUE form", () => {
		snap("FD_TEST_EXPORT");
		delEnv("FD_TEST_EXPORT");
		writeFileSync(join(tmp, ".env"), "export FD_TEST_EXPORT=exported\n");
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("FD_TEST_EXPORT")).toBe("exported");
	});

	test(".env.local takes precedence over .env", () => {
		snap("FD_TEST_PREC");
		delEnv("FD_TEST_PREC");
		writeFileSync(join(tmp, ".env"), "FD_TEST_PREC=base\n");
		writeFileSync(join(tmp, ".env.local"), "FD_TEST_PREC=local\n");
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("FD_TEST_PREC")).toBe("local");
	});

	test("bash precedence: .env value overrides inherited env (parity)", () => {
		snap("FD_TEST_OVER");
		setEnv("FD_TEST_OVER", "preset");
		writeFileSync(join(tmp, ".env"), "FD_TEST_OVER=from-env\n");
		loadDotEnvIntoProcess(tmp);
		// Bash `source .env` overwrites; TS must match.
		expect(getEnv("FD_TEST_OVER")).toBe("from-env");
		// Cross-check against bash for confidence.
		const r = spawnSync("bash", ["-c", `export FD_TEST_OVER=preset; source "$1"; echo "$FD_TEST_OVER"`, "_", join(tmp, ".env")], { encoding: "utf8" });
		expect(r.stdout.trim()).toBe("from-env");
	});

	test("unbound variable reference fails loud (set -u parity)", () => {
		// .env containing `$NO_SUCH_VAR` should fail under bash
		// `set -euo pipefail` (which the originals use). Silently
		// defaulting routes state files to the wrong directory.
		snap("FD_UNSET_REF");
		delEnv("FD_UNSET_REF");
		delEnv("FD_REALLY_NO_SUCH_VAR");
		writeFileSync(join(tmp, ".env"), "FD_UNSET_REF=$FD_REALLY_NO_SUCH_VAR\n");
		const probe = `
			import { loadDotEnvIntoProcess } from "${join(import.meta.dir, "../../src/shared/project.ts")}";
			try { loadDotEnvIntoProcess(${JSON.stringify(tmp)}); } catch {}
			process.stdout.write(String(process.env.FD_UNSET_REF ?? ""));
		`;
		const r = spawnSync("bun", ["-e", probe], { encoding: "utf8" });
		expect(r.status).toBe(2);
		expect(r.stdout).toBe("");
		// Cross-check: bash exits nonzero under set -u for the same .env.
		const bashCheck = spawnSync("bash", ["-c", "set -euo pipefail; source \"$1\"; echo \"$FD_UNSET_REF\"", "_", join(tmp, ".env")], { encoding: "utf8" });
		expect(bashCheck.status).not.toBe(0);
	});

	test("source failure aborts the load (set -e parity with bash)", () => {
		// A bare `false` inside .env should abort sourcing and prevent
		// later assignments from being imported. Bash originals run
		// under `set -euo pipefail`, so `source .env` exits immediately.
		snap("FD_TEST_BEFORE", "FD_TEST_AFTER");
		delEnv("FD_TEST_BEFORE");
		delEnv("FD_TEST_AFTER");
		writeFileSync(join(tmp, ".env"), "FD_TEST_BEFORE=before\nfalse\nFD_TEST_AFTER=after\n");
		// Spawn a child so the process.exit(2) inside loadDotEnv doesn't
		// kill the test runner.
		const probe = `
			import { loadDotEnvIntoProcess } from "${join(import.meta.dir, "../../src/shared/project.ts")}";
			try { loadDotEnvIntoProcess(${JSON.stringify(tmp)}); } catch {}
			process.stdout.write(String(process.env.FD_TEST_BEFORE ?? "") + "|" + String(process.env.FD_TEST_AFTER ?? ""));
		`;
		const r = spawnSync("bun", ["-e", probe], { encoding: "utf8" });
		expect(r.status).toBe(2);
		// FD_TEST_AFTER must NOT be set (bash aborts source on `false`).
		expect(r.stdout).not.toContain("after");
		// Cross-check: bash exits 1 on the same input under set -e.
		const bashCheck = spawnSync("bash", ["-c", "set -e; source \"$1\"; echo \"$FD_TEST_AFTER\"", "_", join(tmp, ".env")], { encoding: "utf8" });
		expect(bashCheck.status).not.toBe(0);
		expect(bashCheck.stdout).not.toContain("after");
	});

	test("does not leak shell builtins like PATH into process.env replace", () => {
		// Sourcing under set -a auto-exports everything including
		// re-assignments to PATH. We only import keys declared in the
		// file; PATH should be untouched.
		snap("PATH");
		const originalPath = getEnv("PATH");
		writeFileSync(join(tmp, ".env"), "FD_TEST_UNRELATED=x\n");
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("PATH")).toBe(originalPath);
	});
});

describe("loadDotEnvIntoProcess native fast-path", () => {
	test("plain KEY=VALUE skips bash subprocess", () => {
		// The fast-path runs in-process — measurable via wall-clock. We
		// can't reliably assert subprocess absence from inside the test
		// runner, but we can confirm correctness by content and that the
		// load completes in O(µs) not O(ms).
		snap("FD_FAST_K1", "FD_FAST_K2");
		delEnv("FD_FAST_K1");
		delEnv("FD_FAST_K2");
		writeFileSync(join(tmp, ".env"), "FD_FAST_K1=a\nexport FD_FAST_K2=\"b c\"\n# comment\n");
		const t0 = performance.now();
		loadDotEnvIntoProcess(tmp);
		const dt = performance.now() - t0;
		expect(getEnv("FD_FAST_K1")).toBe("a");
		expect(getEnv("FD_FAST_K2")).toBe("b c");
		// Bash startup alone is ~5–30ms. Native parse is sub-millisecond.
		expect(dt).toBeLessThan(5);
	});

	test("shell-feature lines route to bash subprocess", () => {
		// $VAR substitution forces the bash path. The result should be
		// the expanded value, not the literal `${FD_OUTER}` text.
		snap("FD_SLOW_K1", "FD_OUTER");
		delEnv("FD_SLOW_K1");
		setEnv("FD_OUTER", "expanded");
		writeFileSync(join(tmp, ".env"), "FD_SLOW_K1=prefix-${FD_OUTER}\n");
		loadDotEnvIntoProcess(tmp);
		expect(getEnv("FD_SLOW_K1")).toBe("prefix-expanded");
		delEnv("FD_OUTER");
	});

	test("`false` line forces bash path and aborts under set -e", () => {
		snap("FD_AFTER");
		delEnv("FD_AFTER");
		writeFileSync(join(tmp, ".env"), "false\nFD_AFTER=after\n");
		// The `false` line lacks `=`, so usesShellFeatures returns true
		// and the bash path runs under set -e. Test in a subprocess to
		// avoid exiting the runner.
		const probe = `
			import { loadDotEnvIntoProcess } from "${join(import.meta.dir, "../../src/shared/project.ts")}";
			try { loadDotEnvIntoProcess(${JSON.stringify(tmp)}); } catch {}
		`;
		const r = spawnSync("bun", ["-e", probe], { encoding: "utf8" });
		expect(r.status).toBe(2);
	});
});

describe("loadDotEnvIntoProcess edge-case parity (round-3 dispatch)", () => {
	// Helper: run TS load in a child so process.exit/2 doesn't kill the
	// runner. Returns the resulting env keys plus values that match keys
	// in the .env file. Bash reference uses set -euo pipefail + source.
	function loadKeys(envText: string, keys: string[]): { ts: Record<string, string>; bash: Record<string, string>; tsExit: number | null; bashExit: number | null } {
		const envPath = join(tmp, ".env");
		writeFileSync(envPath, envText);
		const keyList = keys.join(" ");
		const tsProbe = `
			import { loadDotEnvIntoProcess } from "${join(import.meta.dir, "../../src/shared/project.ts")}";
			for (const k of ${JSON.stringify(keys)}) delete process.env[k];
			try { loadDotEnvIntoProcess(${JSON.stringify(tmp)}); } catch {}
			const out = {};
			for (const k of ${JSON.stringify(keys)}) out[k] = process.env[k] ?? null;
			process.stdout.write(JSON.stringify(out));
		`;
		const tsR = spawnSync("bun", ["-e", tsProbe], { encoding: "utf8" });
		const tsParsed = tsR.stdout ? JSON.parse(tsR.stdout) as Record<string, string | null> : {};
		const ts: Record<string, string> = {};
		for (const [k, v] of Object.entries(tsParsed)) if (v !== null) ts[k] = v;

		const bashScript = `set -euo pipefail; source "$1"; for k in ${keyList}; do printf '%s\\0%s\\0' "$k" "\${!k:-}"; done`;
		const bashR = spawnSync("bash", ["-c", bashScript, "_", envPath], { encoding: "utf8" });
		const bash: Record<string, string> = {};
		if (bashR.status === 0) {
			const parts = (bashR.stdout ?? "").split("\0");
			for (let i = 0; i + 1 < parts.length; i += 2) {
				if (parts[i]) bash[parts[i]!] = parts[i + 1] ?? "";
			}
		}
		return { ts, bash, tsExit: tsR.status, bashExit: bashR.status };
	}

	test("inline trailing comment: KEY=foo # note (bash strips, native must match)", () => {
		const { ts, bash } = loadKeys("FD_COMMENT=foo # note\n", ["FD_COMMENT"]);
		expect(ts).toEqual(bash);
		expect(bash.FD_COMMENT).toBe("foo");
	});

	test("semicolon multi-assignment: A=one; B=two", () => {
		const { ts, bash } = loadKeys("FD_A=one; FD_B=two\n", ["FD_A", "FD_B"]);
		expect(ts).toEqual(bash);
		expect(bash.FD_A).toBe("one");
		expect(bash.FD_B).toBe("two");
	});

	test("multi-key export: export A=1 B=2", () => {
		const { ts, bash } = loadKeys("export FD_A=1 FD_B=2\n", ["FD_A", "FD_B"]);
		expect(ts).toEqual(bash);
		expect(bash.FD_A).toBe("1");
		expect(bash.FD_B).toBe("2");
	});
});

describe("loadDotEnvIntoProcess matches bash source byte-for-byte", () => {
	test("complex .env with mixed forms", () => {
		const envFile = join(tmp, ".env");
		writeFileSync(envFile, [
			"# comment",
			"FD_PARITY_PLAIN=val1",
			'FD_PARITY_QUOTED="quoted val"',
			"FD_PARITY_FB=${FD_NOT_SET:-fbval}",
			"export FD_PARITY_EXPORT=ev",
			"",
		].join("\n"));
		// Bash reference
		const bashScript = `set -a; source "$1"; set +a; for k in FD_PARITY_PLAIN FD_PARITY_QUOTED FD_PARITY_FB FD_PARITY_EXPORT; do echo "$k=\${!k}"; done`;
		const r = spawnSync("bash", ["-c", bashScript, "_", envFile], { encoding: "utf8" });
		expect(r.status).toBe(0);
		const bashVals: Record<string, string> = {};
		for (const line of r.stdout.split("\n")) {
			const eq = line.indexOf("=");
			if (eq > 0) bashVals[line.slice(0, eq)] = line.slice(eq + 1);
		}
		// TS load
		for (const k of Object.keys(bashVals)) {
			snap(k);
			delEnv(k);
		}
		loadDotEnvIntoProcess(tmp);
		for (const [k, v] of Object.entries(bashVals)) {
			expect(getEnv(k)).toBe(v);
		}
	});
});
