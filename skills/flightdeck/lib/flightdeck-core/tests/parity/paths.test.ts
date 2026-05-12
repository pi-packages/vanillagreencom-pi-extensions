// Parity tests for the lib/paths/*.ts ports.
// For pure-function helpers (encoders, UUID, issue extraction), source
// the bash helper and assert the TS port returns the same value.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ccEncodeCwd, ccUuidForIssue } from "../../src/paths/cc.ts";
import { ocIssueFromPaneTarget } from "../../src/paths/oc.ts";
import { fdSessionKeyFromId } from "../../src/paths/daemon.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_LIB = resolve(HERE, "../../../../scripts/lib");

function callBash(script: string, fn: string, ...args: string[]): string {
	const argStr = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
	const r = spawnSync("bash", ["-c", `source '${SCRIPTS_LIB}/${script}'; ${fn} ${argStr}`], { encoding: "utf8" });
	return (r.stdout ?? "").replace(/\n$/, "");
}

describe("paths parity", () => {
	test("cc_encode_cwd parity", () => {
		const cases = ["/home/foo", "/home/method/dev/x/y", "/", "/single"];
		for (const c of cases) {
			expect(ccEncodeCwd(c)).toBe(callBash("cc-channel-paths.sh", "cc_encode_cwd", c));
		}
	});

	test("cc_uuid_for_issue parity", () => {
		for (const issue of ["CC-486", "CC-1", "OC-9999", "AB-CDEF"]) {
			expect(ccUuidForIssue(issue)).toBe(callBash("cc-channel-paths.sh", "cc_uuid_for_issue", issue));
		}
	});

	test("oc_issue_from_pane_target parity", () => {
		for (const t of ["HT:cc-9012.1", "session:CC-486.0", "S:OC-1.0", "x:ab-12.3"]) {
			expect(ocIssueFromPaneTarget(t)).toBe(callBash("oc-paths.sh", "oc_issue_from_pane_target", t));
		}
	});

	test("fd_session_key_from_id parity", () => {
		for (const id of ["$143", "$0", "$9999"]) {
			expect(fdSessionKeyFromId(id)).toBe(callBash("daemon-paths.sh", "fd_session_key_from_id", id));
		}
	});
});
