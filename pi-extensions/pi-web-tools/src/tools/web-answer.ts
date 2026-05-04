import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { ExaClient } from "../providers/exa.js";
import type { WebToolsSettings } from "../settings.js";
import { sourceList } from "../utils/format.js";

export const webAnswerSchema = Type.Object({ query: Type.String() });
export type WebAnswerInput = Static<typeof webAnswerSchema>;

export function createWebAnswerToolDefinition(getSettings: (cwd?: string) => WebToolsSettings, name = "web_answer") {
	return {
		name,
		label: "Web Answer",
		description: "Quick cited answer via Exa answer endpoint.",
		promptSnippet: "Get a quick cited answer from Exa.",
		parameters: webAnswerSchema,
		async execute(_toolCallId: string, params: WebAnswerInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const client = new ExaClient({ apiKey: getSettings(ctx.cwd).apiKeys.exa });
			const response = await client.answer(params.query, signal);
			return { content: [{ type: "text", text: `${response.answer ?? "No answer returned."}\n\nSources:\n${sourceList(response.results)}` }], details: response };
		},
	};
}
