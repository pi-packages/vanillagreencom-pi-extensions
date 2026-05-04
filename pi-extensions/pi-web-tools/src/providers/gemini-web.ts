export async function geminiWebFetch(): Promise<never> {
	throw new Error("Gemini Web cookie-backed extraction is staged and remains opt-in; use web_fetch with regular HTTP/Exa content for now.");
}
