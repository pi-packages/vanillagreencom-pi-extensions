// Port of scripts/lib/oc-paths.sh — opencode HTTP-attach adapter.
// Port range 18430-18529 host-global. Per-issue spawn discovery files.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fdAdapterFreshnessCacheGet, fdAdapterFreshnessCacheSet, fdResolveStateDir } from "./daemon.ts";
import { lockedAllocPort, lockedRegisterPortPid, lockedReleasePort } from "../state/locking.ts";

export const OC_PORT_RANGE_START = 18430;
export const OC_PORT_RANGE_END = 18529;

export const ocPortsFile = () => join(fdResolveStateDir(), "oc-ports.json");
export const ocPortsLock = () => join(fdResolveStateDir(), "oc-ports.lock");
export const ocSpawnFile = (issue: string) => join(fdResolveStateDir(), `oc-spawn-${issue}.json`);

export const ocPaneIdSafe = (id: string) => id.replace(/^%/, "");
export const ocSubscriberPidFile = (paneId: string, sessionKey: string) =>
	join(fdResolveStateDir(), `fd-subscriber-${sessionKey}-${ocPaneIdSafe(paneId)}.pid`);
export const ocServerLog = (issue: string) => join(fdResolveStateDir(), `oc-serve-${issue}.log`);
export const ocWakeEventsLog = (sessionKey: string) => join(fdResolveStateDir(), `fd-wake-events-${sessionKey}.log`);

// Sync /dev/tcp probe via bash subshell — matches bash's blocking semantics.
export function ocPortIsFree(port: number): boolean {
	const r = spawnSync("bash", ["-c", `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null`]);
	return r.status !== 0;
}

// All allocator/release/register operations happen under flock held by
// the locking helper's bash child for the full critical section. Matches
// the bash `oc_alloc_port` / `oc_release_port` / `oc_register_port_pid`
// flock-209 contract.

export function ocAllocPort(issue: string): number | null {
	const owner = JSON.stringify({ issue, pid: process.pid });
	const r = lockedAllocPort(ocPortsLock(), ocPortsFile(), OC_PORT_RANGE_START, OC_PORT_RANGE_END, owner);
	if (r.status === 1) return null; // range exhausted
	if (r.status !== 0) return null;
	const port = Number.parseInt((r.stdout ?? "").trim(), 10);
	return Number.isFinite(port) ? port : null;
}

export function ocReleasePort(port: number): void {
	lockedReleasePort(ocPortsLock(), ocPortsFile(), port);
}

export function ocRegisterPortPid(port: number, pid: number): void {
	lockedRegisterPortPid(ocPortsLock(), ocPortsFile(), port, pid);
}

function isPidAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}

export interface OcSpawnRecord {
	url?: string;
	session_id?: string;
	port?: number;
	server_pid?: number;
	[k: string]: unknown;
}

function readSpawnFile(issue: string): OcSpawnRecord | null {
	const file = ocSpawnFile(issue);
	if (!existsSync(file)) return null;
	try { return JSON.parse(readFileSync(file, "utf8")) as OcSpawnRecord; }
	catch { return null; }
}

export function ocAdapterIsFresh(issue: string): boolean {
	if (!issue) return false;
	const rec = readSpawnFile(issue);
	if (!rec) return false;
	const pid = Number(rec.server_pid);
	if (!Number.isFinite(pid) || pid <= 0 || !isPidAlive(pid)) return false;
	const url = typeof rec.url === "string" ? rec.url : "";
	const sid = typeof rec.session_id === "string" ? rec.session_id : "";
	if (!url || !sid) return false;
	const key = `oc|${url}|${sid}`;
	const cached = fdAdapterFreshnessCacheGet(key);
	if (cached !== null) return cached;
	const r = spawnSync("curl", ["-fsS", "--max-time", "1", `${url}/session/${sid}/message`], { stdio: ["ignore", "ignore", "ignore"] });
	const ok = r.status === 0;
	fdAdapterFreshnessCacheSet(key, ok);
	return ok;
}

export function ocAttachArgsFromSpawn(issue: string): string | null {
	const rec = readSpawnFile(issue);
	if (!rec) return null;
	if (!ocAdapterIsFresh(issue)) return null;
	const url = typeof rec.url === "string" ? rec.url : "";
	const sid = typeof rec.session_id === "string" ? rec.session_id : "";
	if (!url || !sid || url === "null" || sid === "null") return null;
	return `--url ${url} --session ${sid}`;
}

// "HT:CC-9012.1" → "CC-9012"
export function ocIssueFromPaneTarget(target: string): string {
	const winName = (target.split(":")[1] ?? target).split(".")[0] ?? "";
	return winName.toUpperCase();
}

// jq filter as a constant — same as bash. Consumers shell out to jq.
export const OC_LAST_ASSISTANT_JQ = `
  ( . // [] )
  | ( if type == "object" then (.messages // .data // .items // []) else . end )
  | [ .[] | select(((.info.role // .role // .message.role) // "") == "assistant") ]
  | last
  | if . == null then ""
    else
      (
        ((.parts // []) | map(select(.type == "text") | .text // "") | join(""))
        // .text
        // .content
        // ((.message.content // []) | map(.text // "") | join(""))
        // ""
      )
    end
`;
