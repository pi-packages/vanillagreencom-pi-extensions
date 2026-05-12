// Unit tests for the lib/paths/*.ts ports. Pure-function helpers
// (encoders, derivers, jq filter strings) — no subprocess dependencies.

import { describe, expect, test } from "bun:test";
import { ccEncodeCwd, ccUuidForIssue, ccTranscriptPath } from "../../src/paths/cc.ts";
import { ocIssueFromPaneTarget, ocPaneIdSafe } from "../../src/paths/oc.ts";
import { fdSessionKeyFromId } from "../../src/paths/daemon.ts";
import { homedir } from "node:os";
import { join } from "node:path";

describe("cc encode/uuid", () => {
	test("ccEncodeCwd replaces all slashes with dashes", () => {
		expect(ccEncodeCwd("/home/method/dev/foo")).toBe("-home-method-dev-foo");
	});

	test("ccUuidForIssue is deterministic and 36 chars", () => {
		const a = ccUuidForIssue("CC-486");
		const b = ccUuidForIssue("CC-486");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	test("ccUuidForIssue differs across issues", () => {
		expect(ccUuidForIssue("CC-486")).not.toBe(ccUuidForIssue("CC-487"));
	});

	test("ccTranscriptPath joins encoded cwd + uuid under ~/.claude/projects", () => {
		const got = ccTranscriptPath("/home/foo/x", "abcd1234-5678-90ab-cdef-1234567890ab");
		expect(got).toBe(join(homedir(), ".claude/projects/-home-foo-x/abcd1234-5678-90ab-cdef-1234567890ab.jsonl"));
	});
});

describe("oc helpers", () => {
	test("ocIssueFromPaneTarget extracts uppercased issue", () => {
		expect(ocIssueFromPaneTarget("HT:cc-9012.1")).toBe("CC-9012");
		expect(ocIssueFromPaneTarget("session:CC-486.0")).toBe("CC-486");
	});

	test("ocPaneIdSafe strips leading %", () => {
		expect(ocPaneIdSafe("%47")).toBe("47");
		expect(ocPaneIdSafe("47")).toBe("47");
	});
});

describe("daemon session key", () => {
	test("fdSessionKeyFromId strips $ prefix", () => {
		expect(fdSessionKeyFromId("$143")).toBe("s143");
		expect(fdSessionKeyFromId("$0")).toBe("s0");
	});

	test("fdSessionKeyFromId returns empty on empty input", () => {
		expect(fdSessionKeyFromId("")).toBe("");
	});
});
