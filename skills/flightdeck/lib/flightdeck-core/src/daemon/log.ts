// Port of scripts/flightdeck-daemon.bash::log + warn.
//
// Append a timestamped line to the daemon log file; mirror to stdout
// (log) or stderr (warn) only when that stream is a tty. The bash
// daemon redirects stdout to the log itself when running detached, so
// the `isTTY` guard prevents double-writing.

import { appendFileSync } from "node:fs";

function isoNow(): string {
	// Match `date -Iseconds` format (`2026-05-11T22:34:56-07:00`).
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, "0");
	const yyyy = d.getFullYear();
	const mm = pad(d.getMonth() + 1);
	const dd = pad(d.getDate());
	const hh = pad(d.getHours());
	const mi = pad(d.getMinutes());
	const ss = pad(d.getSeconds());
	const tzMin = -d.getTimezoneOffset();
	const sign = tzMin >= 0 ? "+" : "-";
	const abs = Math.abs(tzMin);
	const tzh = pad(Math.floor(abs / 60));
	const tzm = pad(abs % 60);
	return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${tzh}:${tzm}`;
}

// Warn at most once per process when log append fails so a misconfigured
// log directory doesn't silently swallow every daemon log line.
let warnedFailure = false;
function appendLog(logFile: string, line: string): void {
	try { appendFileSync(logFile, line); }
	catch (e) {
		if (!warnedFailure) {
			warnedFailure = true;
			const msg = (e as NodeJS.ErrnoException).message ?? String(e);
			process.stderr.write(`flightdeck-daemon: log append failed (${logFile}): ${msg}\n`);
		}
	}
}

export function daemonLog(logFile: string, tag: string, msg: string): void {
	const line = `${isoNow()} [${tag}] ${msg}\n`;
	appendLog(logFile, line);
	if (process.stdout.isTTY) process.stdout.write(line);
}

export function daemonWarn(logFile: string, tag: string, msg: string): void {
	const line = `${isoNow()} [${tag}] ${msg}\n`;
	appendLog(logFile, line);
	process.stderr.write(line);
}
