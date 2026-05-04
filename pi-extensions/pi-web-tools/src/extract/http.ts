export async function fetchHttpContent(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP fetch failed (${response.status}) for ${url}`);
	return response.text();
}
