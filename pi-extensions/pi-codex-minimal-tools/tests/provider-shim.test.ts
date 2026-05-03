import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { synthesizeNativeToolEvents } from "../src/provider-shim.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of iterable) out.push(item);
	return out;
}

test("synthesizeNativeToolEvents saves image_generation_call output and emits text", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-native-image-"));
	const events = collect(synthesizeNativeToolEvents((async function* () {
		yield { type: "response.created", response: { id: "resp_1" } };
		yield { type: "response.output_item.done", item: { type: "image_generation_call", id: "img_1", result: Buffer.from("png").toString("base64"), output_format: "png" } };
	})(), cwd));
	const output = await events;
	assert.equal(output[0]?.type, "response.created");
	assert.ok(output.some((event) => event.type === "response.output_text.delta" && String(event.delta).includes("Generated image saved")));
	const delta = output.find((event) => event.type === "response.output_text.delta")?.delta as string;
	const match = delta.match(/saved to (.+?) \(latest:/);
	assert.ok(match?.[1]);
	assert.ok(existsSync(match[1]));
});


test("synthesizeNativeToolEvents emits concise web search status", async () => {
	const output = await collect(synthesizeNativeToolEvents((async function* () {
		yield { type: "response.output_item.done", item: { type: "web_search_call", id: "web_1", query: "Pi coding agent" } };
	})()));
	assert.ok(output.some((event) => event.type === "response.output_text.delta" && String(event.delta).includes("Web search completed for: Pi coding agent")));
});
