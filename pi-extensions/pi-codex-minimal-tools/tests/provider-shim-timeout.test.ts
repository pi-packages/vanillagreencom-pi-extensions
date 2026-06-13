import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { fetchWithResponseHeaderTimeout } from "../src/provider-shim.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("fetchWithResponseHeaderTimeout aborts when SSE response headers stall", async () => {
	globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (signal?.aborted) {
				reject(new Error("aborted before fetch"));
				return;
			}
			signal?.addEventListener("abort", () => reject(new Error("aborted by test")), { once: true });
		})) as typeof fetch;

	await assert.rejects(
		() => fetchWithResponseHeaderTimeout("https://example.test/backend-api/codex/responses", { method: "POST" }, undefined, 1),
		/Codex Responses SSE response headers timed out after 1ms/,
	);
});
