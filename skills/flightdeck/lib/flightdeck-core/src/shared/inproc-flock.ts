// In-process flock(2) advisory lock via bun:ffi. Spawning `flock(1)`
// as a subprocess just to hold a few jq calls in a critical section
// adds ~4 forks per call on hot paths (freshness cache, port allocator
// sweep). This module calls flock(2) on a file descriptor opened in
// the current process — same lock semantics, zero subprocess overhead.
//
// LOCK_EX = 2, LOCK_UN = 8 on Linux. POSIX also uses these values; if
// they differ on macOS the function falls back to the flock(1) binary.
//
// The bun:ffi import is dynamic so this module is safe to load on
// runtimes that don't expose bun:ffi (vanilla node, future Bun without
// FFI). Callers check `inprocFlockAvailable()` before invoking
// `withInprocFlock`.

import { closeSync, openSync } from "node:fs";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const O_RDWR = 0o2;
const O_CREAT = 0o100;

interface FlockSyms { flock: (fd: number, op: number) => number }

let _syms: FlockSyms | null | undefined;

function syms(): FlockSyms | null {
	if (_syms !== undefined) return _syms;
	try {
		// Dynamic import — fails cleanly on non-Bun runtimes or Bun
		// builds without FFI rather than failing module load.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const ffi = require("bun:ffi") as { dlopen: (path: string, defs: Record<string, unknown>) => { symbols: Record<string, unknown> }; FFIType: { i32: number } };
		const lib = ffi.dlopen("libc.so.6", {
			flock: { args: [ffi.FFIType.i32, ffi.FFIType.i32], returns: ffi.FFIType.i32 },
		});
		_syms = lib.symbols as unknown as FlockSyms;
	} catch {
		_syms = null;
	}
	return _syms;
}

// Run `fn` while holding an exclusive flock(2) lock on `lockPath`.
// Returns whatever `fn` returns. Falls back to throwing if libc.so.6
// isn't dlopenable on the host (musl, BSD, etc.) — callers should pick
// a fallback path that uses the flock(1) binary.
export function withInprocFlock<T>(lockPath: string, fn: () => T): T {
	const s = syms();
	if (!s) throw new Error("inproc-flock unavailable on this platform");
	// Create the lock file if missing — bash `exec FD>"$lockPath"`
	// also creates it. Mode 0o600 keeps it user-private.
	const fd = openSync(lockPath, O_RDWR | O_CREAT, 0o600);
	try {
		const rc = s.flock(fd, LOCK_EX);
		if (rc !== 0) throw new Error(`flock(LOCK_EX) returned ${rc}`);
		try {
			return fn();
		} finally {
			s.flock(fd, LOCK_UN);
		}
	} finally {
		closeSync(fd);
	}
}

// Cheap availability probe so callers can pick the native path or fall
// back to the subprocess pattern. Memoized.
export function inprocFlockAvailable(): boolean {
	return syms() !== null;
}

// Open and atomically try-acquire an exclusive flock on `lockPath`.
// Returns the held fd on success (caller owns it and must close it on
// release / process exit), or null when another process holds the
// lock. Critical for the daemon's PID-lock retry loop: blocking
// flock(LOCK_EX) defeats the 30×0.2s grace window.
export function tryAcquireLockFd(lockPath: string): number | null {
	const s = syms();
	if (!s) throw new Error("inproc-flock unavailable on this platform");
	const fd = openSync(lockPath, O_RDWR | O_CREAT, 0o600);
	const rc = s.flock(fd, LOCK_EX | LOCK_NB);
	if (rc !== 0) {
		closeSync(fd);
		return null;
	}
	return fd;
}

// Release a held lock + close the fd. Called from the daemon's exit
// path. Best-effort — process exit releases all locks anyway.
export function releaseLockFd(fd: number): void {
	const s = syms();
	if (!s) return;
	try { s.flock(fd, LOCK_UN); } catch { /* */ }
	try { closeSync(fd); } catch { /* */ }
}
