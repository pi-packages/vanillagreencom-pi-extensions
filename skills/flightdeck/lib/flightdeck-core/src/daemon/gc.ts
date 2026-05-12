// Port of scripts/flightdeck-daemon.bash::gc_orphan_state.
//
// Startup garbage collection for orphaned daemon state files: sessions
// that no longer exist in tmux. Also sweeps subscriber pid files whose
// recorded pid is dead.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fdSessionKeyFromId } from "../paths/daemon.ts";

function pidAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

function readPidFile(file: string): number | null {
	if (!existsSync(file)) return null;
	try {
		const txt = readFileSync(file, "utf8").trim();
		if (!/^[1-9][0-9]*$/.test(txt)) return null;
		return Number.parseInt(txt, 10);
	} catch { return null; }
}

function liveSessionKeys(): Set<string> {
	const out = new Set<string>();
	const r = spawnSync("tmux", ["list-sessions", "-F", "#{session_id}"], { encoding: "utf8" });
	if (r.status !== 0) return out;
	for (const line of (r.stdout ?? "").split("\n")) {
		const sid = line.trim();
		if (!sid) continue;
		const k = fdSessionKeyFromId(sid);
		if (k) out.add(k);
	}
	return out;
}

interface GcOpts {
	stateDir: string;
	lockedCleanupForKey: (key: string) => void;
	log: (tag: string, msg: string) => void;
}

export function gcOrphanState(opts: GcOpts): void {
	const { stateDir, lockedCleanupForKey, log } = opts;
	const live = liveSessionKeys();
	let entries: string[];
	try { entries = readdirSync(stateDir); } catch { return; }

	// Single pass over the directory entries. Phase 1 removes orphan
	// per-session daemon state when the session no longer exists in
	// tmux and the recorded pid is dead. Phase 2 sweeps subscriber
	// pid files whose pid is dead. The previous version walked the
	// readdir result twice; combining halves the directory-stat work
	// for a state dir with hundreds of orphan files.
	for (const entry of entries) {
		const daemonMatch = /^fd-daemon-(s\d+)\.pid$/.exec(entry);
		if (daemonMatch) {
			const key = daemonMatch[1]!;
			if (live.has(key)) continue;
			const pidFile = join(stateDir, entry);
			const pid = readPidFile(pidFile);
			if (pid !== null && pidAlive(pid)) continue;
			log("gc", `removing orphan state for dead session ${key} (pid=${pid ?? ""})`);
			// Lock-aware cleanup of wake/events/draining state.
			try { lockedCleanupForKey(key); } catch { /* best-effort */ }
			// Direct removal of files with no in-flight contract. NEVER
			// glob `${key}.*` — the `.session-lock` file would match and
			// splitting future locking onto a new inode would break the
			// atomic ack contract.
			for (const suffix of [
				`fd-daemon-${key}.pid`,
				`fd-daemon-${key}.lock`,
				`fd-daemon-${key}.log`,
				`fd-daemon-${key}.heartbeat`,
				`fd-master-${key}.busy`,
				`fd-wake-events-${key}.log`,
			]) {
				try { unlinkSync(join(stateDir, suffix)); } catch { /* missing OK */ }
			}
			continue;
		}
		if (/^fd-(?:cc-|pi-|cx-)?subscriber-.*\.pid$/.test(entry)) {
			const file = join(stateDir, entry);
			const pid = readPidFile(file);
			if (pid !== null && pidAlive(pid)) continue;
			try { unlinkSync(file); } catch { /* missing OK */ }
		}
	}
}
