export async function geminiSearch(): Promise<never> {
	throw new Error("Gemini API web_search/content fallback is staged for a follow-up; use provider=exa or provider=openai-native for now.");
}
