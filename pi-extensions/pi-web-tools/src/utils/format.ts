export function truncateText(value: string, maxChars = 12000): { text: string; truncated: boolean } {
	if (value.length <= maxChars) return { text: value, truncated: false };
	return { text: `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} characters]`, truncated: true };
}

export function jsonText(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function sourceList(results: Array<{ title?: string; url?: string }>): string {
	return results.map((result, index) => `${index + 1}. ${result.title || result.url || "Untitled"}${result.url ? ` — ${result.url}` : ""}`).join("\n");
}
