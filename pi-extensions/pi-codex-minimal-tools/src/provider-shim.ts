import {
	createAssistantMessageEventStream,
	getEnvApiKey,
	registerApiProvider,
	streamOpenAICodexResponses,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { loadSettings } from "./settings.js";
import { rewriteNativeOpenAiTools } from "./provider-native-tools.js";
import { saveBase64Image } from "./utils/images.js";

const SHIM_SOURCE_ID = "vstack.pi-codex-minimal-tools";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
const CODEX_RESPONSE_STATUSES = new Set(["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"]);
let installed = false;
type ResponseStreamEvent = Record<string, any>;
type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

function clampReasoningLevelCompat(model: Model<"openai-codex-responses">, level: unknown): ReasoningLevel {
	if (!model.reasoning) return "off";
	if (level !== "minimal" && level !== "low" && level !== "medium" && level !== "high" && level !== "xhigh") return "off";
	if (model.thinkingLevelMap?.[level] === null) {
		const order: ReasoningLevel[] = ["high", "medium", "low", "minimal"];
		return order.find((candidate) => model.thinkingLevelMap?.[candidate] !== null) ?? "off";
	}
	return level;
}

function hasNativeMinimalTools(context: Context): boolean {
	return Boolean(context.tools?.some((tool) => tool.name === "image_generation" || tool.name === "web_search"));
}

function extractAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
		const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		if (!accountId) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

function resolveCodexUrl(baseUrl: string): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

function sanitizeText(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/g, "�");
}

function convertMessages(model: Model<"openai-codex-responses">, context: Context): unknown[] {
	const messages: unknown[] = [];
	let msgIndex = 0;
	for (const msg of context.messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") messages.push({ role: "user", content: [{ type: "input_text", text: sanitizeText(msg.content) }] });
			else messages.push({ role: "user", content: msg.content.map((item) => item.type === "text" ? { type: "input_text", text: sanitizeText(item.text) } : { type: "input_image", detail: "auto", image_url: `data:${item.mimeType};base64,${item.data}` }) });
		} else if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "text") messages.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: sanitizeText(block.text), annotations: [] }], status: "completed", id: `msg_${msgIndex}` });
				else if (block.type === "toolCall") {
					const [callId, itemId] = block.id.split("|");
					messages.push({ type: "function_call", id: itemId || `fc_${msgIndex}`, call_id: callId, name: block.name, arguments: JSON.stringify(block.arguments) });
				}
			}
		} else if (msg.role === "toolResult") {
			const text = msg.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
			const [callId] = msg.toolCallId.split("|");
			messages.push({ type: "function_call_output", call_id: callId, output: sanitizeText(text || "(no output)") });
		}
		msgIndex++;
	}
	return messages;
}

function convertTools(context: Context): unknown[] | undefined {
	if (!context.tools?.length) return undefined;
	return context.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: null }));
}

function parseStreamingJson(text: string): Record<string, unknown> {
	try { return JSON.parse(text || "{}"); } catch { return {}; }
}

function encodeTextSignature(id: string): string {
	return JSON.stringify({ v: 1, id });
}

async function processNativeAwareResponsesStream(events: AsyncIterable<ResponseStreamEvent>, output: AssistantMessage, stream: ReturnType<typeof createAssistantMessageEventStream>): Promise<void> {
	let currentItem: ResponseStreamEvent | null = null;
	let currentBlock: any = null;
	const blockIndex = () => output.content.length - 1;
	for await (const event of events) {
		if (event.type === "response.created" && event.response?.id) output.responseId = event.response.id;
		else if (event.type === "response.output_item.added") {
			const item = event.item ?? {};
			currentItem = item;
			if (item.type === "reasoning") {
				currentBlock = { type: "thinking", thinking: "" };
				output.content.push(currentBlock);
				stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
			} else if (item.type === "message") {
				currentBlock = { type: "text", text: "" };
				output.content.push(currentBlock);
				stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
			} else if (item.type === "function_call") {
				currentBlock = { type: "toolCall", id: `${item.call_id}|${item.id}`, name: item.name, arguments: {}, partialJson: item.arguments || "" };
				output.content.push(currentBlock);
				stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
			}
		} else if (event.type === "response.reasoning_summary_text.delta" && currentBlock?.type === "thinking") {
			currentBlock.thinking += event.delta || "";
			stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: event.delta || "", partial: output });
		} else if (event.type === "response.output_text.delta" && currentBlock?.type === "text") {
			currentBlock.text += event.delta || "";
			stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: event.delta || "", partial: output });
		} else if (event.type === "response.function_call_arguments.delta" && currentBlock?.type === "toolCall") {
			currentBlock.partialJson += event.delta || "";
			currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
			stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta: event.delta || "", partial: output });
		} else if (event.type === "response.function_call_arguments.done" && currentBlock?.type === "toolCall") {
			currentBlock.partialJson = event.arguments || currentBlock.partialJson;
			currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
		} else if (event.type === "response.output_item.done") {
			const item = event.item ?? {};
			if (item.type === "reasoning" && currentBlock?.type === "thinking") {
				currentBlock.thinking = item.summary?.map?.((part: any) => part.text).join("\n\n") || currentBlock.thinking;
				currentBlock.thinkingSignature = JSON.stringify(item);
				stream.push({ type: "thinking_end", contentIndex: blockIndex(), content: currentBlock.thinking, partial: output });
				currentBlock = null;
			} else if (item.type === "message" && currentBlock?.type === "text") {
				currentBlock.text = item.content?.map?.((part: any) => part.type === "output_text" ? part.text : part.refusal).join("") || currentBlock.text;
				currentBlock.textSignature = encodeTextSignature(item.id || `msg_${blockIndex()}`);
				stream.push({ type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output });
				currentBlock = null;
			} else if (item.type === "function_call") {
				const args = currentBlock?.type === "toolCall" ? parseStreamingJson(currentBlock.partialJson || item.arguments || "{}") : parseStreamingJson(item.arguments || "{}");
				const toolCall = currentBlock?.type === "toolCall" ? currentBlock : { type: "toolCall", id: `${item.call_id}|${item.id}`, name: item.name, arguments: args };
				toolCall.arguments = args;
				delete toolCall.partialJson;
				currentBlock = null;
				stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
			}
		} else if (event.type === "response.completed") {
			const response = event.response ?? {};
			if (response.id) output.responseId = response.id;
			const usage = response.usage ?? {};
			const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
			output.usage = { input: (usage.input_tokens || 0) - cachedTokens, output: usage.output_tokens || 0, cacheRead: cachedTokens, cacheWrite: 0, totalTokens: usage.total_tokens || 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
			output.stopReason = output.content.some((block) => block.type === "toolCall") ? "toolUse" : response.status === "incomplete" ? "length" : "stop";
		} else if (event.type === "error") throw new Error(`Error Code ${event.code}: ${event.message}`);
	}
}

function buildHeaders(model: Model<"openai-codex-responses">, options: SimpleStreamOptions | undefined, accountId: string, token: string): Headers {
	const headers = new Headers(model.headers);
	for (const [key, value] of Object.entries(options?.headers || {})) headers.set(key, value);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("originator", "pi");
	headers.set("User-Agent", "pi-codex-minimal-tools");
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	if (options?.sessionId) {
		headers.set("session_id", options.sessionId);
		headers.set("x-client-request-id", options.sessionId);
	}
	return headers;
}

function buildRequestBody(model: Model<"openai-codex-responses">, context: Context, options: SimpleStreamOptions | undefined): Record<string, unknown> {
	const messages = convertMessages(model, context);
	const body: Record<string, unknown> = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt,
		input: messages,
		text: { verbosity: (options as Record<string, unknown> | undefined)?.textVerbosity || "low" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: options?.sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
	};
	if (options?.temperature !== undefined) body.temperature = options.temperature;
	if ((options as Record<string, unknown> | undefined)?.serviceTier !== undefined) body.service_tier = (options as Record<string, unknown>).serviceTier;
	const tools = convertTools(context);
	if (tools && tools.length > 0) body.tools = tools;
	if (options?.reasoning !== undefined) {
		const clamped = clampReasoningLevelCompat(model, options.reasoning);
		if (clamped !== "off") {
			const effort = model.thinkingLevelMap?.[clamped] ?? clamped;
			if (effort !== null) body.reasoning = { effort, summary: "auto" };
		}
	}
	return rewriteNativeOpenAiTools(body).payload as Record<string, unknown>;
}

async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n\n");
			while (idx !== -1) {
				const chunk = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n").trim();
				if (data && data !== "[DONE]") {
					try { yield JSON.parse(data) as Record<string, unknown>; } catch { /* ignore malformed SSE chunks */ }
				}
				idx = buffer.indexOf("\n\n");
			}
		}
	} finally {
		try { await reader.cancel(); } catch { /* noop */ }
		try { reader.releaseLock(); } catch { /* noop */ }
	}
}

function normalizeCodexEvent(event: Record<string, unknown>): Record<string, unknown> {
	if (event.type === "response.done" || event.type === "response.completed" || event.type === "response.incomplete") {
		const response = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : undefined;
		const status = typeof response?.status === "string" && CODEX_RESPONSE_STATUSES.has(response.status) ? response.status : undefined;
		return { ...event, type: "response.completed", response: response ? { ...response, status } : response };
	}
	return event;
}

function syntheticTextEvents(text: string, id: string): ResponseStreamEvent[] {
	return [
		{ type: "response.output_item.added", output_index: 0, item: { id, type: "message", role: "assistant", status: "in_progress", content: [] } } as unknown as ResponseStreamEvent,
		{ type: "response.content_part.added", item_id: id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } } as unknown as ResponseStreamEvent,
		{ type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta: text } as unknown as ResponseStreamEvent,
		{ type: "response.output_item.done", output_index: 0, item: { id, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } } as unknown as ResponseStreamEvent,
	];
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) if (typeof value === "string" && value.length > 0) return value;
	return undefined;
}

function imageBase64FromItem(item: Record<string, unknown>): string | undefined {
	return firstString(item.result, item.image, item.data, item.b64_json, (item.output as Record<string, unknown> | undefined)?.result, (item.output as Record<string, unknown> | undefined)?.b64_json);
}

export async function* synthesizeNativeToolEvents(events: AsyncIterable<Record<string, unknown>>, cwd = process.cwd()): AsyncGenerator<ResponseStreamEvent> {
	let responseId = "response";
	let syntheticIndex = 0;
	for await (const raw of events) {
		const event = normalizeCodexEvent(raw);
		const response = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : undefined;
		if (typeof response?.id === "string") responseId = response.id;
		const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : undefined;
		if (event.type === "error") throw new Error(`Codex error: ${firstString(event.message, event.code) || JSON.stringify(event)}`);
		if (event.type === "response.failed") throw new Error(firstString(response?.error && typeof response.error === "object" ? (response.error as Record<string, unknown>).message : undefined) || "Codex response failed");
		if (event.type === "response.output_item.done" && item?.type === "image_generation_call") {
			const base64 = imageBase64FromItem(item);
			if (base64) {
				const saved = await saveBase64Image({ base64, callId: firstString(item.id, item.call_id), cwd, format: firstString(item.output_format, item.format), responseId, settings: loadSettings(cwd) });
				for (const synthetic of syntheticTextEvents(`Generated image saved to ${saved.path}${saved.latestPath ? ` (latest: ${saved.latestPath})` : ""}.`, `vstack-image-${syntheticIndex++}`)) yield synthetic;
			} else {
				for (const synthetic of syntheticTextEvents("Image generation completed, but no base64 image payload was present in the provider event.", `vstack-image-${syntheticIndex++}`)) yield synthetic;
			}
			continue;
		}
		if (event.type === "response.output_item.done" && item?.type === "web_search_call") {
			const query = firstString(item.query, (item.action as Record<string, unknown> | undefined)?.query);
			for (const synthetic of syntheticTextEvents(`Web search completed${query ? ` for: ${query}` : ""}.`, `vstack-web-${syntheticIndex++}`)) yield synthetic;
			continue;
		}
		yield event as unknown as ResponseStreamEvent;
	}
}

function emptyAssistant(model: Model<"openai-codex-responses">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function streamNativeAwareOpenAICodexResponses(model: Model<"openai-codex-responses">, context: Context, options?: SimpleStreamOptions) {
	if (!hasNativeMinimalTools(context)) return streamOpenAICodexResponses(model, context, options as never);
	const stream = createAssistantMessageEventStream();
	void (async () => {
		const output = emptyAssistant(model);
		try {
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			const body = buildRequestBody(model, context, options);
			const nextBody = await options?.onPayload?.(body, model);
			const finalBody = nextBody !== undefined ? nextBody : body;
			const response = await fetch(resolveCodexUrl(model.baseUrl), {
				method: "POST",
				headers: buildHeaders(model, options, extractAccountId(apiKey), apiKey),
				body: JSON.stringify(finalBody),
				signal: options?.signal,
			});
			await options?.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model);
			if (!response.ok) throw new Error(await response.text());
			stream.push({ type: "start", partial: output });
			await processNativeAwareResponsesStream(synthesizeNativeToolEvents(parseSSE(response), process.cwd()), output, stream);
			stream.push({ type: "done", reason: output.stopReason === "error" || output.stopReason === "aborted" ? "stop" : output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
}

export function installNativeAwareCodexProviderShim(): void {
	if (installed) return;
	registerApiProvider({
		api: "openai-codex-responses",
		stream: streamNativeAwareOpenAICodexResponses as never,
		streamSimple: streamNativeAwareOpenAICodexResponses as never,
	}, SHIM_SOURCE_ID);
	installed = true;
}
