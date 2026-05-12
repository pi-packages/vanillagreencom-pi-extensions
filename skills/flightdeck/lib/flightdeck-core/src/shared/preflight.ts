// Dependency preflight checks. Each CLI entry calls preflightDeps()
// with the specific tool set its action needs so missing system tools
// fail loud rather than silently degrading.
//
// Matches the bash daemon's `_check_deps_inline` contract: exit 2 on
// missing dep (usage-error style), `command -v` probe under bash so
// builtins like `command` resolve regardless of PATH.

import { spawnSync } from "node:child_process";

// Mandatory for any flightdeck-core CLI invocation: state CRUD reads jq,
// every locked critical section uses flock, every CLI entry already
// runs under bash (the trampoline forwards through it), `tmux` is the
// session resolution channel and `awk`/`sha256sum` are used by capture
// hashing + per-tick pane attribute parsing.
export const FULL_REQUIRED = ["jq", "flock", "bash", "tmux", "awk", "sha256sum"] as const;

// Minimal set for actions that only touch local state files and don't
// need to talk to tmux: turn-end ack / turn-start drain. lockedEventsDrain
// uses bash + flock to hold the session lock for the rename + cat; jq
// is not invoked on this path (the drain is a plain mv + cat).
export const STATE_ONLY_REQUIRED = ["flock", "bash"] as const;

const checked = new Set<string>();

function isOnPath(bin: string): boolean {
	const r = spawnSync("command", ["-v", bin], { encoding: "utf8", shell: "/bin/bash" });
	return r.status === 0 && (r.stdout ?? "").trim().length > 0;
}

export function preflightDeps(required: readonly string[] = FULL_REQUIRED): void {
	const missing: string[] = [];
	for (const bin of required) {
		if (checked.has(bin)) continue;
		checked.add(bin);
		if (!isOnPath(bin)) missing.push(bin);
	}
	if (missing.length > 0) {
		process.stderr.write(
			`Error: required dependency missing: ${missing.join(", ")}\n` +
			`Install them and retry. flightdeck-core requires jq, flock, bash, tmux, awk, sha256sum; ` +
			`optional features may also need curl, gh, bun.\n`,
		);
		process.exit(2);
	}
}

// Register cleanup-on-signal so SIGINT / SIGTERM don't leak temp files
// from an in-flight critical section. Each caller registers its own
// cleanup; we install handlers once.
const cleanupCallbacks: Array<() => void> = [];
let signalHandlersInstalled = false;

export function onShutdown(cb: () => void): void {
	cleanupCallbacks.push(cb);
	if (signalHandlersInstalled) return;
	signalHandlersInstalled = true;
	const handler = (sig: NodeJS.Signals): void => {
		for (const cb of cleanupCallbacks) {
			try { cb(); } catch { /* swallow — best-effort */ }
		}
		// Re-raise default signal so the parent sees the right exit
		// code rather than a synthetic 0. process.exit can't propagate
		// signal-style exits, so simulate via kill(SIGNUM) on self.
		process.removeAllListeners(sig);
		process.kill(process.pid, sig);
	};
	process.on("SIGINT", handler);
	process.on("SIGTERM", handler);
	process.on("SIGHUP", handler);
}
