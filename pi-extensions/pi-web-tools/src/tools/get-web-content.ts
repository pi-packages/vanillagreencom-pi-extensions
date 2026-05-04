import { Type, type Static } from "typebox";
import { getWebContent } from "../storage.js";
import { truncateText } from "../utils/format.js";

export const getWebContentSchema = Type.Object({
	id: Type.String({ description: "Content id returned by web_search or web_fetch." }),
	maxCharacters: Type.Optional(Type.Number()),
});
export type GetWebContentInput = Static<typeof getWebContentSchema>;

export function createGetWebContentToolDefinition(name = "get_web_content") {
	return {
		name,
		label: "Get Web Content",
		description: "Retrieve full stored content from prior pi-web-tools calls by content id.",
		promptSnippet: "Retrieve stored full web content by id.",
		parameters: getWebContentSchema,
		async execute(_toolCallId: string, params: GetWebContentInput) {
			const item = getWebContent(params.id);
			if (!item) throw new Error(`No stored web content found for id: ${params.id}`);
			const { text, truncated } = truncateText(item.content, params.maxCharacters ?? 50000);
			return { content: [{ type: "text", text: `${item.title ?? item.url ?? item.id}\n${item.url ?? ""}\n\n${text}${truncated ? "\n\n[Use a larger maxCharacters value for more.]" : ""}` }], details: item };
		},
	};
}
