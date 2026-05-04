import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/deep-research", import.meta.url).pathname;

test("doctor reports runtime status", () => {
  const result = spawnSync(process.execPath, [script, "doctor"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.fetch, true);
});

test("missing key fails with setup instructions", () => {
  const env = { ...process.env };
  delete env.EXA_API_KEY;
  delete env.EXA_MOCK_RESPONSE_FILE;
  const cwd = mkdtempSync(join(tmpdir(), "deep-research-no-env-"));
  const result = spawnSync(process.execPath, [script, "report", "question"], { encoding: "utf8", env, cwd });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXA_API_KEY/);
});

test("mocked report writes findings and raw output", () => {
  const dir = mkdtempSync(join(tmpdir(), "deep-research-"));
  const mock = join(dir, "mock.json");
  const output = join(dir, "findings.md");
  const raw = join(dir, "raw.json");
  writeFileSync(mock, JSON.stringify({ answer: "Answer", results: [{ title: "Source", url: "https://example.com" }] }));
  const result = spawnSync(process.execPath, [script, "report", "question", "--output", output, "--raw-output", raw], { encoding: "utf8", env: { ...process.env, EXA_MOCK_RESPONSE_FILE: mock } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, "utf8"), /## Evidence and Sources/);
  assert.match(readFileSync(output, "utf8"), /https:\/\/example\.com/);
  assert.match(readFileSync(raw, "utf8"), /Answer/);
});

test("resolves EXA_API_KEY op:// references with op CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "deep-research-op-"));
  const bin = join(dir, "bin");
  const mock = join(dir, "mock.json");
  const output = join(dir, "findings.md");
  mkdirSync(bin, { recursive: true });
  writeFileSync(mock, JSON.stringify({ answer: "Answer", results: [{ title: "Source", url: "https://example.com" }] }));
  writeFileSync(join(bin, "op"), "#!/usr/bin/env bash\n[ \"$1\" = read ] && [ \"$2\" = 'op://vault/exa/key' ] && { printf resolved-exa; exit 0; }\nexit 1\n");
  chmodSync(join(bin, "op"), 0o755);
  const result = spawnSync(process.execPath, [script, "report", "question", "--output", output], {
    encoding: "utf8",
    env: { ...process.env, EXA_API_KEY: "op://vault/exa/key", EXA_MOCK_RESPONSE_FILE: mock, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, "utf8"), /Answer/);
});
