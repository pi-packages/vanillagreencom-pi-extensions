// Port of scripts/lib/pi-bridge-paths.sh — pi Session Bridge adapter.
// One Unix-socket bridge per pi pid, discovered post-spawn from
// `pi-bridge list --json`.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import { fdResolveStateDir } from "./daemon.ts";

export const piSpawnFile = (issue: string) => join(fdResolveStateDir(), `pi-spawn-${issue}.json`);
export const piPaneIdSafe = (id: string) => id.replace(/^%/, "");
export const piSubscriberPidFile = (paneId: string, sessionKey: string) =>
	join(fdResolveStateDir(), `fd-pi-subscriber-${sessionKey}-${piPaneIdSafe(paneId)}.pid`);

function isExecutable(path: string): boolean {
	try {
		// Bash uses `[[ -x ... ]]` — check stat mode bits.
		const s = statSync(path);
		return s.isFile() && (s.mode & 0o111) !== 0;
	} catch { return false; }
}

// Prefer PI_BRIDGE_BIN, then PATH, then ~/.pi/agent/bin/pi-bridge.
export function piResolveBridgeBin(): string | null {
	const env = process.env.PI_BRIDGE_BIN;
	if (env && isExecutable(env)) return env;
	const which = spawnSync("command", ["-v", "pi-bridge"], { encoding: "utf8", shell: "/bin/bash" });
	const fromPath = (which.stdout ?? "").trim();
	if (fromPath && isExecutable(fromPath)) return fromPath;
	const canonical = join(homedir(), ".pi/agent/bin/pi-bridge");
	if (isExecutable(canonical)) return canonical;
	return null;
}

export function piResolvePiBin(): string | null {
	const env = process.env.PI_BIN;
	if (env && isExecutable(env)) return env;
	if (isExecutable("/usr/bin/pi")) return "/usr/bin/pi";
	const r = spawnSync("bash", ["-c", "type -P pi 2>/dev/null"], { encoding: "utf8" });
	const path = (r.stdout ?? "").trim();
	if (path && isExecutable(path)) return path;
	return null;
}

export function piResolveBridgeExtension(): string | null {
	const env = process.env.PI_SESSION_BRIDGE_EXTENSION;
	if (env && existsSync(env)) return env;
	const canonical = join(homedir(), ".pi/agent/packages/pi-session-bridge/extensions/session-bridge.ts");
	if (existsSync(canonical)) return canonical;
	return null;
}

interface BridgeListRow { pid: number; cwd: string; sessionId?: string; startedAt?: number; started_at?: number }

function listBridges(bin: string): BridgeListRow[] {
	const r = spawnSync(bin, ["list", "--json"], { encoding: "utf8" });
	if (r.status !== 0) return [];
	try {
		const arr = JSON.parse(r.stdout ?? "[]");
		return Array.isArray(arr) ? arr : [];
	} catch { return []; }
}

export function piSnapshotPids(): number[] {
	const bin = piResolveBridgeBin();
	if (!bin) return [];
	return listBridges(bin).map((row) => row.pid).filter((p) => Number.isFinite(p) && p > 0);
}

// Wait for a new pi-bridge pid matching the worktree cwd, excluding
// the pre-snapshot pids.
export async function piDiscoverPid(wtPath: string, timeoutSec = 30, prePids: number[] = []): Promise<number | null> {
	const bin = piResolveBridgeBin();
	if (!bin) return null;
	const absWt = resolve(wtPath);
	const deadline = Date.now() + timeoutSec * 1000;
	const preSet = new Set(prePids);
	while (Date.now() < deadline) {
		const rows = listBridges(bin)
			.filter((r) => (r.cwd ?? "") === absWt)
			.filter((r) => !preSet.has(r.pid));
		if (rows.length > 0) {
			rows.sort((a, b) => (a.startedAt ?? a.started_at ?? 0) - (b.startedAt ?? b.started_at ?? 0));
			return rows[rows.length - 1]!.pid;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return null;
}

export function piBridgeIsFresh(pid: number, socket: string): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); } catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code !== "EPERM") return false;
	}
	if (!existsSync(socket)) return false;
	try {
		const s = statSync(socket);
		if (!s.isSocket()) return false;
	} catch { return false; }
	const bin = piResolveBridgeBin();
	if (!bin) return false;
	const target = socket ? ["--socket", socket] : ["--pid", String(pid)];
	const r = spawnSync(bin, ["state", ...target], { encoding: "utf8" });
	if (r.status !== 0) return false;
	try {
		const obj = JSON.parse(r.stdout ?? "{}");
		return obj?.data?.protocol === "pi-session-bridge.v1";
	} catch { return false; }
}

// jq filter for last assistant text from `pi-bridge history`.
export const PI_LAST_ASSISTANT_JQ = `
  ( .data.events // [] )
  | map(select(.data.message.role == "assistant" and (.data.message.stopReason // "") != ""))
  | last
  | if . == null then ""
    else
      ( .data.message.content // [] )
      | (if type == "array" then map(select(.type == "text") | .text // "") | join("") else . end)
    end
`;
