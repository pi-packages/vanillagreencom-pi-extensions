import assert from "node:assert/strict";
import test from "node:test";
import { computeNextActiveTools } from "../src/active-tools.js";
import { resolveWebProvider } from "../src/provider-selection.js";
import { DEFAULT_SETTINGS, type WebToolsSettings } from "../src/settings.js";

function settings(overrides: Partial<WebToolsSettings> = {}): WebToolsSettings {
	return { ...DEFAULT_SETTINGS, apiKeys: {}, warnings: [], ...overrides } as WebToolsSettings;
}

test("auto provider resolution follows Exa then OpenAI native order", () => {
	const model = { provider: "openai-codex", id: "gpt-5.5" };
	assert.equal(resolveWebProvider("auto", settings({ apiKeys: { exa: "key" } }), model).provider, "exa");
	assert.equal(resolveWebProvider("auto", settings(), model).provider, "openai-native");
	assert.equal(resolveWebProvider("auto", settings({ nativeOpenAiWebSearch: false }), model).provider, undefined);
});

test("active tool sync preserves native tools and avoids duplicate ownership", () => {
	const current = ["read", "bash", "image_generation", "web_search"];
	const next = computeNextActiveTools(current, { provider: "openai-codex", id: "gpt-5.5" }, settings());
	assert.ok(next.includes("read"));
	assert.ok(next.includes("bash"));
	assert.ok(next.includes("image_generation"));
	assert.ok(next.includes("web_search"));
});
