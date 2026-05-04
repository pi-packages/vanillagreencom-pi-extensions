import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { ExaClient } from "../providers/exa.js";
import type { WebToolsSettings } from "../settings.js";
import { storeWebContent } from "../storage.js";

export const webFetchSchema = Type.Object({
	url: Type.Optional(Type.String()),
	urls: Type.Optional(Type.Array(Type.String())),
	textMaxCharacters: Type.Optional(Type.Number()),
});
export type WebFetchInput = Static<typeof webFetchSchema>;

function urls(params: WebFetchInput): string[] {
	const items = [...(params.urls ?? [])];
	if (params.url) items.unshift(params.url);
	return items.map((url) => url.trim()).filter(Boolean);
}

export function createWebFetchToolDefinition(pi: ExtensionAPI, getSettings: (cwd?: string) => WebToolsSettings, name = "web_fetch") {
	return {
		name,
		label: name === "web_fetch" ? "Web Fetch" : "Fetch Content",
		description: "Fetch known URL content through Exa getContents and store the full text for get_web_content. Regular HTML/PDF/GitHub/video fallback parity is staged for follow-up.",
		promptSnippet: "Fetch and store known URL content for later retrieval.",
		parameters: webFetchSchema,
		async execute(_toolCallId: string, params: WebFetchInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const settings = getSettings(ctx.cwd);
			const list = urls(params);
			if (list.length === 0) throw new Error(`${name} requires url or urls.`);
			const client = new ExaClient({ apiKey: settings.apiKeys.exa });
			const response = await client.contents({ urls: list, textMaxCharacters: params.textMaxCharacters }, signal);
			const stored = response.results.map((result) => storeWebContent(pi, { title: result.title, url: result.url, content: result.text || result.summary || "", metadata: { provider: "exa", tool: name } }));
			return { content: [{ type: "text", text: `Fetched ${stored.length} URL(s).\n${stored.map((item) => `- ${item.id}: ${item.title ?? item.url ?? "content"}`).join("\n")}` }], details: { provider: "exa", stored } };
		},
	};
}
