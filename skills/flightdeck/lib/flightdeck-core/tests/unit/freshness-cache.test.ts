// Unit test: fdAdapterFreshnessCacheSet writes entries via the native
// flock(2) R-M-W path (no flock(1) subprocess), and concurrent writers
// don't lose each other's entries.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	fdAdapterFreshnessCacheFile,
	fdAdapterFreshnessCacheSet,
	fdAdapterFreshnessCacheGet,
} from "../../src/paths/daemon.ts";

let tmp = "";
const orig: Record<string, string | undefined> = {};

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "fd-fresh-"));
	orig["FD_STATE_DIR"] = process.env.FD_STATE_DIR;
	orig["FD_ADAPTER_FRESHNESS_TTL"] = process.env.FD_ADAPTER_FRESHNESS_TTL;
	process.env.FD_STATE_DIR = tmp;
	process.env.FD_ADAPTER_FRESHNESS_TTL = "60";
});

afterEach(() => {
	for (const [k, v] of Object.entries(orig)) {
		if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
		else (process.env as Record<string, string>)[k] = v;
	}
	if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("freshness cache native R-M-W", () => {
	test("set + get round-trip", () => {
		fdAdapterFreshnessCacheSet("alpha", true);
		fdAdapterFreshnessCacheSet("beta", false);
		expect(fdAdapterFreshnessCacheGet("alpha")).toBe(true);
		expect(fdAdapterFreshnessCacheGet("beta")).toBe(false);
		expect(fdAdapterFreshnessCacheGet("missing")).toBeNull();
	});

	test("corrupt JSON gets rotated to .corrupt.<ts>", () => {
		const file = fdAdapterFreshnessCacheFile();
		writeFileSync(file, "not valid json{{");
		fdAdapterFreshnessCacheSet("recovered", true);
		const obj = JSON.parse(readFileSync(file, "utf8"));
		expect(obj.recovered.ok).toBe(true);
		// Rotated sidecar should exist.
		const { readdirSync } = require("node:fs") as typeof import("node:fs");
		const sidecars = readdirSync(tmp).filter((f) => f.includes("corrupt"));
		expect(sidecars.length).toBeGreaterThan(0);
	});

	test("10 concurrent writers preserve all 10 keys", async () => {
		// Spawn 10 children truly in parallel via async spawn so they
		// contend on the lock. The previous serialized version with
		// spawnSync inside Promise.all blocked each child to completion
		// before launching the next — not a real contention test.
		const { spawn } = await import("node:child_process");
		const probeScript = (k: string) => `
			import { fdAdapterFreshnessCacheSet } from "${join(import.meta.dir, "../../src/paths/daemon.ts")}";
			fdAdapterFreshnessCacheSet(${JSON.stringify(k)}, true);
		`;
		await Promise.all(
			Array.from({ length: 10 }, (_, i) => new Promise<void>((res, rej) => {
				const env = { ...(process.env as Record<string, string>), FD_STATE_DIR: tmp, FD_ADAPTER_FRESHNESS_TTL: "60" };
				const p = spawn("bun", ["-e", probeScript(`k${i}`)], { env });
				p.on("exit", (code) => code === 0 ? res() : rej(new Error(`probe exit ${code}`)));
			})),
		);
		const obj = JSON.parse(readFileSync(fdAdapterFreshnessCacheFile(), "utf8"));
		const keys = Object.keys(obj).sort();
		expect(keys).toEqual(["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"]);
	});
});
