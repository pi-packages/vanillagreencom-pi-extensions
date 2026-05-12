// Port of scripts/lib/codex-paths.sh — codex app-server adapter.
// One app-server per flightdeck session (per session_key), not per pane.
// Port range 41030-41039 host-global. Per-pane `codex --remote ws://...`
// TUIs run as separate threads against the shared server.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fdAdapterFreshnessCacheGet, fdAdapterFreshnessCacheSet, fdResolveStateDir } from "./daemon.ts";
import { lockedAllocPort, lockedRegisterPortPid, lockedReleasePort } from "../state/locking.ts";

export const CX_PORT_RANGE_START = 41030;
export const CX_PORT_RANGE_END = 41039;

export const cxPortsFile = () => join(fdResolveStateDir(), "cx-app-server-ports.json");
export const cxPortsLock = () => join(fdResolveStateDir(), "cx-app-server-ports.lock");
export const cxAppServerFile = (sessionKey: string) => join(fdResolveStateDir(), `cx-app-server-${sessionKey}.json`);
export const cxAppServerLog = (sessionKey: string) => join(fdResolveStateDir(), `cx-app-server-${sessionKey}.log`);
export const cxSpawnFile = (issue: string) => join(fdResolveStateDir(), `cx-spawn-${issue}.json`);

export const cxPaneIdSafe = (id: string) => id.replace(/^%/, "");
export const cxSubscriberPidFile = (paneId: string, sessionKey: string) =>
	join(fdResolveStateDir(), `fd-cx-subscriber-${sessionKey}-${cxPaneIdSafe(paneId)}.pid`);

export function cxPortIsFree(port: number): boolean {
	const r = spawnSync("bash", ["-c", `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null`]);
	return r.status !== 0;
}

export function cxAllocPort(sessionKey: string): number | null {
	const owner = JSON.stringify({ pid: process.pid, session_key: sessionKey });
	const r = lockedAllocPort(cxPortsLock(), cxPortsFile(), CX_PORT_RANGE_START, CX_PORT_RANGE_END, owner);
	if (r.status !== 0) return null;
	const port = Number.parseInt((r.stdout ?? "").trim(), 10);
	return Number.isFinite(port) ? port : null;
}

export function cxReleasePort(port: number): void {
	lockedReleasePort(cxPortsLock(), cxPortsFile(), port);
}

export function cxRegisterPortPid(port: number, pid: number): void {
	lockedRegisterPortPid(cxPortsLock(), cxPortsFile(), port, pid);
}

function isExecutable(path: string): boolean {
	try {
		const s = statSync(path);
		return s.isFile() && (s.mode & 0o111) !== 0;
	} catch { return false; }
}

export function cxResolveCodexBin(): string | null {
	if (isExecutable("/usr/bin/codex")) return "/usr/bin/codex";
	const r = spawnSync("bash", ["-c", "type -P codex 2>/dev/null"], { encoding: "utf8" });
	const p = (r.stdout ?? "").trim();
	if (p && isExecutable(p)) return p;
	return null;
}

export function cxResolveBunBin(): string | null {
	if (isExecutable("/usr/bin/bun")) return "/usr/bin/bun";
	const r = spawnSync("bash", ["-c", "type -P bun 2>/dev/null"], { encoding: "utf8" });
	const p = (r.stdout ?? "").trim();
	if (p && isExecutable(p)) return p;
	return null;
}

// Resolve the vendored codex-bridge.ts relative to this module's location.
// The path is stable: skills/flightdeck/lib/codex-bridge/bridge.ts, three
// levels up from this file (lib/flightdeck-core/src/paths/ → skills/flightdeck/lib/codex-bridge/).
export function cxBridgeTsPath(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(here, "../../../codex-bridge/bridge.ts");
	if (existsSync(candidate)) return candidate;
	return null;
}

export function cxBridgeRun(
	args: string[],
	opts: { env?: Record<string, string> } = {},
): { status: number | null; stdout: string; stderr: string } {
	const bun = cxResolveBunBin();
	if (!bun) return { status: 1, stderr: "bun not found", stdout: "" };
	const script = cxBridgeTsPath();
	if (!script) return { status: 1, stderr: "codex-bridge.ts not found", stdout: "" };
	const env = opts.env ? { ...(process.env as Record<string, string>), ...opts.env } : process.env;
	const r = spawnSync(bun, [script, ...args], { encoding: "utf8", env });
	return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

export interface CxSpawnRecord {
	url?: string;
	thread_id?: string;
	[k: string]: unknown;
}

function readSpawnFile(issue: string): CxSpawnRecord | null {
	const file = cxSpawnFile(issue);
	if (!existsSync(file)) return null;
	try { return JSON.parse(readFileSync(file, "utf8")) as CxSpawnRecord; }
	catch { return null; }
}

export function cxAdapterIsFresh(issue: string): boolean {
	if (!issue) return false;
	const rec = readSpawnFile(issue);
	if (!rec) return false;
	const url = typeof rec.url === "string" ? rec.url : "";
	const thread = typeof rec.thread_id === "string" ? rec.thread_id : "";
	if (!url || !thread) return false;
	const key = `cx|${url}|${thread}`;
	const cached = fdAdapterFreshnessCacheGet(key);
	if (cached !== null) return cached;
	const timeout = process.env.FD_CODEX_RPC_TIMEOUT_MS ?? "1000";
	const r = cxBridgeRun(["list", "--url", url], { env: { FD_CODEX_RPC_TIMEOUT_MS: timeout } });
	const ok = r.status === 0;
	fdAdapterFreshnessCacheSet(key, ok);
	return ok;
}

// jq filter for last assistant text from codex bridge `turns/list`.
export const CX_LAST_ASSISTANT_JQ = `
  ( [ ( .data // [] ) | .[]? | select((.status // "") == "completed") ]
    | sort_by(.completedAt // .startedAt // 0)
    | last
  ) as $turn
  | if $turn == null then ""
    else
      ( $turn.items // [] )
      | map(select(.type == "agentMessage"))
      | last
      | if . == null then ""
        else
          ( .text
            // ( ( .content // [] )
                 | (if type == "array" then map(select(.type == "text") | .text // "") | join("") else . end) )
            // "" )
        end
    end
`;
