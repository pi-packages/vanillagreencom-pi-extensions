import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { ExaClient } from "../providers/exa.js";
import type { WebToolsSettings } from "../settings.js";
import { sourceList } from "../utils/format.js";

export const webFindSimilarSchema = Type.Object({ url: Type.String(), numResults: Type.Optional(Type.Number()), textMaxCharacters: Type.Optional(Type.Number()) });
export type WebFindSimilarInput = Static<typeof webFindSimilarSchema>;

export function createWebFindSimilarToolDefinition(getSettings: (cwd?: string) => WebToolsSettings, name = "web_find_similar") {
	return {
		name,
		label: "Web Find Similar",
		description: "Find pages similar to a URL via Exa findSimilar.",
		parameters: webFindSimilarSchema,
		async execute(_toolCallId: string, params: WebFindSimilarInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const client = new ExaClient({ apiKey: getSettings(ctx.cwd).apiKeys.exa });
			const response = await client.findSimilar(params.url, { numResults: params.numResults, textMaxCharacters: params.textMaxCharacters }, signal);
			return { content: [{ type: "text", text: sourceList(response.results) }], details: response };
		},
	};
}
