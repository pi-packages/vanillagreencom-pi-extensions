// Master-state CRUD on per-tmux-session JSON files.
// Mirrors scripts/flightdeck-state semantics: jq for filter execution,
// flock(1) for atomic write coordination, temp+rename for crash safety.

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { resolveProjectRoot, loadDotEnvIntoProcess } from "../shared/project.ts";
import { lockedJqUpdate, lockedRename } from "./locking.ts";

export function resolveStateBase(): string {
	const root = resolveProjectRoot();
	loadDotEnvIntoProcess(root);
	const dir = process.env.FLIGHTDECK_STATE_DIR && process.env.FLIGHTDECK_STATE_DIR.trim()
		? process.env.FLIGHTDECK_STATE_DIR.trim()
		: "tmp";
	const base = resolve(root, dir);
	mkdirSync(base, { recursive: true });
	return base;
}

export function resolveSession(explicit?: string): string {
	if (explicit && explicit.trim()) return explicit.trim();
	if (!process.env.TMUX) {
		process.stderr.write("Error: no $TMUX session and no --session given\n");
		process.exit(2);
	}
	const r = spawnSync("tmux", ["display-message", "-p", "#S"], { encoding: "utf8" });
	const name = (r.stdout ?? "").trim();
	if (!name) {
		process.stderr.write("Error: tmux display-message returned empty session name\n");
		process.exit(2);
	}
	return name;
}

export function statePath(session: string): string {
	return join(resolveStateBase(), `flightdeck-state-${session}.json`);
}

// Bash accepts `terminated` as shorthand for `.terminated`; mirror it.
export function normalizePath(p: string): string {
	if (p.startsWith(".") || p.startsWith("(.")) return p;
	return `.${p}`;
}

function runJqRaw(filter: string, file: string): string {
	const r = spawnSync("jq", ["-r", filter, file], { encoding: "utf8" });
	if (r.status !== 0) {
		process.stderr.write(r.stderr ?? "");
		process.exit(r.status ?? 1);
	}
	return r.stdout ?? "";
}

// flock(1)-held read-modify-write of the state JSON. The lock is held
// for the whole jq + rename window, matching the bash update_state
// contract. Filter passes through bash positional args (no shell
// interpolation).
export function updateState(file: string, filter: string): void {
	const lock = `${file}.lock`;
	const r = lockedJqUpdate(lock, file, filter);
	if (r.status !== 0) {
		process.stderr.write(r.stderr || "");
		process.exit(r.status ?? 1);
	}
}

export function initState(file: string): void {
	gcTmpOrphans(file);
	const lock = `${file}.lock`;
	// idempotent: the locked jq filter writes the initial state only if
	// the file doesn't already exist. .empty preserves the existing
	// contents; the alternate branch builds the canonical init payload.
	// Locked under the same lock as updateState so concurrent init +
	// set are serialized correctly.
	const session = basename(file).replace(/^flightdeck-state-/, "").replace(/\.json$/, "");
	const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	// jq filter that prefers an existing object over the synthesized init.
	const initFilter = `if (. // {}) | type == "object" and (.issues // null) != null then . else { session_id: "${session}", started_at: "${startedAt}", terminated: false, issues: {}, merge_queue: [], conflict_graph: { edges: [], computed_at: null }, paused_for_user: null } end`;
	if (existsSync(file)) return;
	const r = lockedJqUpdate(lock, file, initFilter);
	if (r.status !== 0) {
		process.stderr.write(r.stderr || "");
		process.exit(r.status ?? 1);
	}
}

export function archiveState(file: string): string | null {
	if (!existsSync(file)) return null;
	let ts = runJqRaw(".terminated_at // empty", file).trim();
	if (!ts) ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	const safeTs = ts.replace(/:/g, "");
	const archive = `${file.replace(/\.json$/, "")}-${safeTs}.json.archive`;
	const lock = `${file}.lock`;
	const r = lockedRename(lock, file, archive);
	if (r.status !== 0) {
		process.stderr.write(r.stderr || "");
		process.exit(r.status ?? 1);
	}
	return archive;
}

function gcTmpOrphans(file: string): void {
	const dir = dirname(file);
	const base = basename(file);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.startsWith(`${base}.tmp.`)) continue;
		const pid = entry.slice(`${base}.tmp.`.length);
		if (!/^\d+$/.test(pid)) continue;
		try {
			process.kill(Number.parseInt(pid, 10), 0);
		} catch (e) {
			// ESRCH = no such process → safe to remove
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "ESRCH") {
				try { unlinkSync(join(dir, entry)); } catch { /* ignore */ }
			}
		}
	}
}

export function readStateText(file: string): string | null {
	if (!existsSync(file)) return null;
	return readFileSync(file, "utf8");
}

export function getField(file: string, jqPath: string): string {
	return runJqRaw(jqPath, file);
}

// stat for caller convenience.
export function stateMtimeMs(file: string): number | null {
	try {
		return statSync(file).mtimeMs;
	} catch {
		return null;
	}
}
