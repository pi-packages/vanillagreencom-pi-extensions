// Parity test: pane-registry (bash) vs pane-registry (TS).
// Runs inside the active tmux session (TMUX env must be set).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../../../../scripts/pane-registry");

if (!process.env.TMUX) {
	test.skip("pane-registry parity requires tmux", () => undefined);
}

function makeRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "fdreg-parity-"));
	spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"], {
		env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
	});
	return dir;
}

function run(useTs: boolean, cwd: string, args: string[]): { stdout: string; stderr: string; status: number | null } {
	const env: Record<string, string> = { ...(process.env as Record<string, string>) };
	if (useTs) {
		env.FLIGHTDECK_USE_TS_PANE_REGISTRY = "1";
		// pane-registry calls flightdeck-state — propagate the TS flip so we
		// exercise the full TS path including state CRUD.
		env.FLIGHTDECK_USE_TS_FLIGHTDECK_STATE = "1";
	} else {
		delete env.FLIGHTDECK_USE_TS_PANE_REGISTRY;
		delete env.FLIGHTDECK_USE_TS_FLIGHTDECK_STATE;
	}
	delete env.FLIGHTDECK_USE_TS;
	env.FLIGHTDECK_STATE_DIR = "tmp";
	const r = spawnSync(SCRIPT, args, { cwd, encoding: "utf8", env });
	return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

function readIssues(repo: string, session = process.env.TMUX_PARITY_SESSION ?? sessionName()): unknown {
	const file = join(repo, "tmp", `flightdeck-state-${session}.json`);
	return JSON.parse(readFileSync(file, "utf8")).issues;
}

function sessionName(): string {
	const r = spawnSync("tmux", ["display-message", "-p", "#S"], { encoding: "utf8" });
	return (r.stdout ?? "").trim();
}

function normalize(issues: unknown): unknown {
	const out: Record<string, Record<string, unknown>> = {};
	for (const [k, v] of Object.entries(issues as Record<string, Record<string, unknown>>)) {
		const copy: Record<string, unknown> = { ...v };
		// timestamps differ between runs
		if (typeof copy.spawned_at === "string") copy.spawned_at = "<ISO>";
		if (typeof copy.last_polled_at === "string") copy.last_polled_at = "<ISO>";
		// pane_id is resolved from tmux — only present when the target pane
		// actually exists. Test windows are fake, so both should be null.
		out[k] = copy;
	}
	return out;
}

let bashRepo = "";
let tsRepo = "";

beforeEach(() => {
	bashRepo = makeRepo();
	tsRepo = makeRepo();
});

afterEach(() => {
	for (const d of [bashRepo, tsRepo]) {
		if (d && existsSync(d)) rmSync(d, { force: true, recursive: true });
	}
});

describe("pane-registry parity", () => {
	test("init writes identical issue record (fake pane)", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			const r = run(useTs, repo, [
				"init", "FAKE-001",
				"--window", "fake-window",
				"--harness", "opencode",
				"--worktree", "/tmp/wt",
			]);
			expect(r.status).toBe(0);
		}
		expect(normalize(readIssues(tsRepo))).toEqual(normalize(readIssues(bashRepo)));
	});

	test("set-state writes valid state", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			run(useTs, repo, ["init", "FAKE-002", "--window", "w2", "--harness", "claude", "--worktree", "/tmp/wt"]);
			const r = run(useTs, repo, ["set-state", "FAKE-002", "prompting"]);
			expect(r.status).toBe(0);
		}
		expect(normalize(readIssues(tsRepo))).toEqual(normalize(readIssues(bashRepo)));
	});

	test("set-state rejects invalid state", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			run(useTs, repo, ["init", "FAKE-003", "--window", "w3", "--harness", "pi", "--worktree", "/tmp/wt"]);
			const r = run(useTs, repo, ["set-state", "FAKE-003", "nonsense"]);
			expect(r.status).toBe(2);
		}
	});

	test("log-decision appends to decisions_log", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			run(useTs, repo, ["init", "FAKE-004", "--window", "w4", "--harness", "codex", "--worktree", "/tmp/wt"]);
			run(useTs, repo, ["log-decision", "FAKE-004", "merge-now", "answered Yes"]);
			run(useTs, repo, ["log-decision", "FAKE-004", "cleanup-prompt", "answered No"]);
		}
		const bIssues = readIssues(bashRepo) as Record<string, { decisions_log: Array<Record<string, unknown>> }>;
		const tIssues = readIssues(tsRepo) as Record<string, { decisions_log: Array<Record<string, unknown>> }>;
		expect(tIssues["FAKE-004"]!.decisions_log.length).toBe(2);
		expect(bIssues["FAKE-004"]!.decisions_log.length).toBe(2);
		// Normalize timestamps
		const norm = (e: Array<Record<string, unknown>>) =>
			e.map((row) => ({ ...row, ts: "<ISO>" }));
		expect(norm(tIssues["FAKE-004"]!.decisions_log)).toEqual(norm(bIssues["FAKE-004"]!.decisions_log));
	});

	test("get returns the issue record; missing → exit 1", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			run(useTs, repo, ["init", "FAKE-005", "--window", "w5", "--harness", "opencode", "--worktree", "/tmp/wt"]);
		}
		const a = run(false, bashRepo, ["get", "FAKE-005"]);
		const b = run(true, tsRepo, ["get", "FAKE-005"]);
		expect(b.status).toBe(0);
		expect(a.status).toBe(0);
		const miss = run(true, tsRepo, ["get", "DOESNT-EXIST"]);
		expect(miss.status).toBe(1);
	});

	test("list --format inner-panes returns CSV of pane_targets", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			run(useTs, repo, ["init", "AAA-001", "--window", "wA", "--harness", "opencode", "--worktree", "/tmp/wt"]);
			run(useTs, repo, ["init", "BBB-002", "--window", "wB", "--harness", "claude", "--worktree", "/tmp/wt"]);
		}
		const a = run(false, bashRepo, ["list", "--format", "inner-panes"]);
		const b = run(true, tsRepo, ["list", "--format", "inner-panes"]);
		expect(b.stdout.trim().split(",").sort()).toEqual(a.stdout.trim().split(",").sort());
	});

	test("find-by-pane resolves an issue", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			// Pin --pane-index 0 so the test target is deterministic across
			// tmux configs that set pane-base-index to 1.
			run(useTs, repo, ["init", "FBP-001", "--window", "wF", "--harness", "pi", "--worktree", "/tmp/wt", "--pane-index", "0"]);
		}
		const session = sessionName();
		const target = `${session}:wF.0`;
		const a = run(false, bashRepo, ["find-by-pane", target]);
		const b = run(true, tsRepo, ["find-by-pane", target]);
		expect(b.stdout.trim()).toBe("FBP-001");
		expect(a.stdout.trim()).toBe("FBP-001");
	});

	test("remove drops the issue from .issues", () => {
		for (const repo of [bashRepo, tsRepo]) {
			const useTs = repo === tsRepo;
			run(useTs, repo, ["init", "RM-001", "--window", "wR", "--harness", "opencode", "--worktree", "/tmp/wt"]);
			const r = run(useTs, repo, ["remove", "RM-001"]);
			expect(r.status).toBe(0);
		}
		expect(readIssues(tsRepo)).toEqual({});
		expect(readIssues(bashRepo)).toEqual({});
	});
});
