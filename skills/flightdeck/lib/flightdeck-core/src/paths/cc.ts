// Port of scripts/lib/cc-channel-paths.sh — claude code Channels MCP adapter.
// Port range 8780-8879 host-global. Per-issue MCP config directory.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fdAdapterFreshnessCacheGet, fdAdapterFreshnessCacheSet, fdResolveStateDir } from "./daemon.ts";
import { lockedAllocPort, lockedRegisterPortPid, lockedReleasePort } from "../state/locking.ts";

export const CC_PORT_RANGE_START = 8780;
export const CC_PORT_RANGE_END = 8879;

export const ccPortsFile = () => join(fdResolveStateDir(), "cc-channel-ports.json");
export const ccPortsLock = () => join(fdResolveStateDir(), "cc-channel-ports.lock");
export const ccSpawnFile = (issue: string) => join(fdResolveStateDir(), `cc-spawn-${issue}.json`);
export const ccMcpDir = (issue: string) => join(fdResolveStateDir(), "cc-channel", issue);
export const ccMcpConfig = (issue: string) => join(ccMcpDir(issue), ".mcp.json");

export const ccPaneIdSafe = (id: string) => id.replace(/^%/, "");
export const ccSubscriberPidFile = (paneId: string, sessionKey: string) =>
	join(fdResolveStateDir(), `fd-cc-subscriber-${sessionKey}-${ccPaneIdSafe(paneId)}.pid`);

export function ccPortIsFree(port: number): boolean {
	const r = spawnSync("bash", ["-c", `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null`]);
	return r.status !== 0;
}

export function ccAllocPort(issue: string): number | null {
	const owner = JSON.stringify({ issue, pid: process.pid });
	const r = lockedAllocPort(ccPortsLock(), ccPortsFile(), CC_PORT_RANGE_START, CC_PORT_RANGE_END, owner);
	if (r.status !== 0) return null;
	const port = Number.parseInt((r.stdout ?? "").trim(), 10);
	return Number.isFinite(port) ? port : null;
}

export function ccReleasePort(port: number): void {
	lockedReleasePort(ccPortsLock(), ccPortsFile(), port);
}

export function ccRegisterPortPid(port: number, pid: number): void {
	lockedRegisterPortPid(ccPortsLock(), ccPortsFile(), port, pid);
}

// "/home/method/dev/foo" → "-home-method-dev-foo"
export function ccEncodeCwd(cwd: string): string {
	return cwd.replace(/\//g, "-");
}

// md5(issue) reshaped to 8-4-4-4-12 hex UUID. Deterministic per-issue.
export function ccUuidForIssue(issue: string): string {
	const h = createHash("md5").update(issue).digest("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function ccTranscriptPath(wtPath: string, uuid: string): string {
	const enc = ccEncodeCwd(resolve(wtPath));
	return join(homedir(), ".claude/projects", enc, `${uuid}.jsonl`);
}

export interface CcSpawnRecord {
	url?: string;
	session_uuid?: string;
	port?: number;
	transcript?: string;
	[k: string]: unknown;
}

function readSpawnFile(issue: string): CcSpawnRecord | null {
	const file = ccSpawnFile(issue);
	if (!existsSync(file)) return null;
	try { return JSON.parse(readFileSync(file, "utf8")) as CcSpawnRecord; }
	catch { return null; }
}

export function ccAdapterIsFresh(issue: string): boolean {
	if (!issue) return false;
	const rec = readSpawnFile(issue);
	if (!rec) return false;
	const port = Number(rec.port);
	const transcript = typeof rec.transcript === "string" ? rec.transcript : "";
	let url = typeof rec.url === "string" ? rec.url : "";
	// Require a regular file (not a directory or other path type).
	if (!transcript) return false;
	try {
		const s = statSync(transcript);
		if (!s.isFile()) return false;
	} catch { return false; }
	if (!Number.isFinite(port) || port <= 0) return false;
	if (!url) url = `http://127.0.0.1:${port}`;
	const key = `cc|${url}|${transcript}`;
	const cached = fdAdapterFreshnessCacheGet(key);
	if (cached !== null) return cached;
	const r = spawnSync("curl", ["-fsS", "--max-time", "1", `${url}/healthz`], { encoding: "utf8" });
	const ok = r.status === 0 && /^ok health/m.test(r.stdout ?? "");
	fdAdapterFreshnessCacheSet(key, ok);
	return ok;
}

// jq filter — extracts last assistant message text from a claude JSONL
// transcript. Used by pane-poll for the CC adapter read path.
export const CC_LAST_ASSISTANT_JQ = `
  [ inputs | select(((.message.role // .role // "") == "assistant")) ]
  | last
  | if . == null then ""
    else
      ( .message.content // .content // [] )
      | (if type == "array" then map(select(.type == "text") | .text // "") | join("") else . end)
    end
`;
