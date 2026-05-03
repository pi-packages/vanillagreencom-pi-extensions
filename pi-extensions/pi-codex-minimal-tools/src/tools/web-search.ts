export const webSearchToolSchema = {
	type: "object",
	additionalProperties: false,
	properties: {},
};

export function createWebSearchToolDefinition() {
	return {
		name: "web_search",
		label: "Web Search",
		description: "OpenAI native web_search placeholder. On supported openai-codex models this package rewrites the provider payload to a native Responses web_search tool; no full provider shim is installed in Phase 1.",
		promptSnippet: "Search the web with OpenAI native web_search when available.",
		parameters: webSearchToolSchema,
		async execute() {
			return {
				content: [{ type: "text", text: "web_search requires native OpenAI provider handling. Phase 1 registers the tool and rewrite metadata but does not include a full provider shim." }],
				details: { phase: 1, nativeTool: "web_search" },
			};
		},
	};
}
