export async function perplexitySearch(): Promise<never> {
	throw new Error("Perplexity web_search provider is configured but direct Perplexity execution is staged for a follow-up; use provider=exa or provider=openai-native for now.");
}
