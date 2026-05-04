import { Type, type Static } from "typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { ExaClient } from "../providers/exa.js";
import type { WebToolsSettings } from "../settings.js";
import { sourceList } from "../utils/format.js";

export const codeSearchSchema = Type.Object({ query: Type.String(), numResults: Type.Optional(Type.Number()), includeDomains: Type.Optional(Type.Array(Type.String())) });
export type CodeSearchInput = Static<typeof codeSearchSchema>;

export function createCodeSearchToolDefinition(getSettings: (cwd?: string) => WebToolsSettings) {
	return {
		name: "code_search",
		label: "Code Search",
		description: "Search code and technical documentation. Uses Exa direct search with code-focused domain hints; Exa MCP get_code_context_exa is staged when available.",
		promptSnippet: "Search for code examples and technical docs via Exa.",
		parameters: codeSearchSchema,
		async execute(_toolCallId: string, params: CodeSearchInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const client = new ExaClient({ apiKey: getSettings(ctx.cwd).apiKeys.exa });
			const includeDomains = params.includeDomains?.length ? params.includeDomains : ["github.com", "docs.github.com", "stackoverflow.com"];
			const response = await client.search({ query: params.query, numResults: params.numResults ?? 8, includeDomains }, signal);
			return { content: [{ type: "text", text: sourceList(response.results) }], details: response };
		},
	};
}
