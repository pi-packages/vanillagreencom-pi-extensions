import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExaClient } from "../src/providers/exa.js";
import { renderFindingsReport, resolveOutputPath } from "../src/tools/web-research.js";

function fakeFetch(bodyOut: any[] = []): typeof fetch {
	return (async (_url: any, init: any) => {
		bodyOut.push(JSON.parse(init.body));
		return new Response(JSON.stringify({ answer: "Synth", results: [{ title: "Source", url: "https://example.com", highlights: ["A"] }] }), { status: 200, headers: { "content-type": "application/json" } });
	}) as typeof fetch;
}

test("Exa deep research request maps params", async () => {
	const bodies: any[] = [];
	const client = new ExaClient({ apiKey: "key", fetchImpl: fakeFetch(bodies), baseUrl: "https://exa.test" });
	await client.deepResearch({ query: "q", type: "deep-reasoning", additionalQueries: ["a"], includeDomains: ["example.com"], textMaxCharacters: 42 });
	assert.equal(bodies[0].query, "q");
	assert.equal(bodies[0].type, "deep-reasoning");
	assert.deepEqual(bodies[0].additionalQueries, ["a"]);
	assert.deepEqual(bodies[0].includeDomains, ["example.com"]);
	assert.equal(bodies[0].contents.text.maxCharacters, 42);
});

test("missing Exa key returns actionable error", () => {
	assert.throws(() => new ExaClient({}), /EXA_API_KEY/);
});

test("findings report includes required sections and citations", () => {
	const report = renderFindingsReport({ query: "Question?" }, { answer: "Answer", results: [{ title: "T", url: "https://example.com" }], raw: { ok: true }, metadata: {} });
	for (const section of ["Executive Summary", "Key Findings", "Evidence and Sources", "Recommendation", "Risks / Unknowns", "Revisit Conditions", "Raw Exa Metadata"]) assert.match(report, new RegExp(section.replace("/", "\\/")));
	assert.match(report, /https:\/\/example\.com/);
});

test("output report write path normalizes @ and relative paths", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-web-tools-path-"));
	assert.equal(resolveOutputPath(cwd, "@docs/findings.md"), join(cwd, "docs", "findings.md"));
});
