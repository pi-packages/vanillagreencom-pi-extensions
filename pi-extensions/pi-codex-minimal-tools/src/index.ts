import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { hasOpenAiModelsLoaded } from "./activation.js";
import { computeNextActiveTools, computeToolCapabilities, modelKey, PACKAGE_TOOL_NAMES, type ModelLike } from "./capabilities.js";
import { rewriteNativeOpenAiTools } from "./provider-native-tools.js";
import { installNativeAwareCodexProviderShim } from "./provider-shim.js";
import { loadSettings } from "./settings.js";
import { createApplyPatchToolDefinition } from "./tools/apply-patch.js";
import { createImageGenerationToolDefinition } from "./tools/image-generation.js";
import { viewImage, viewImageToolSchema, type ViewImageInput } from "./tools/view-image.js";
import { createWebSearchToolDefinition } from "./tools/web-search.js";

const INSTALL_SYMBOL = Symbol.for("vstack.pi-codex-minimal-tools.installed");

function contextModel(ctx: ExtensionContext): ModelLike | undefined {
	return ctx.model as ModelLike | undefined;
}

function removePackageToolsIfPresent(pi: ExtensionAPI): void {
	const active = pi.getActiveTools?.() ?? [];
	const next = active.filter((name) => !PACKAGE_TOOL_NAMES.includes(name as never));
	if (next.length !== active.length) pi.setActiveTools(next);
}

function syncActiveTools(pi: ExtensionAPI, ctx: ExtensionContext, toolsRegistered: boolean): void {
	if (!toolsRegistered || !hasOpenAiModelsLoaded(ctx)) {
		removePackageToolsIfPresent(pi);
		return;
	}
	const settings = loadSettings(ctx.cwd);
	const active = pi.getActiveTools?.() ?? [];
	const next = computeNextActiveTools(active, contextModel(ctx), settings);
	if (next.activeTools.join("\0") !== active.join("\0")) pi.setActiveTools(next.activeTools);
}

function statusLines(pi: ExtensionAPI, ctx: ExtensionContext): string[] {
	const settings = loadSettings(ctx.cwd);
	const model = contextModel(ctx);
	const capabilities = computeToolCapabilities(model, settings);
	const active = new Set(pi.getActiveTools?.() ?? []);
	return [
		"Codex Minimal Tools",
		`model: ${modelKey(model)}`,
		`openai models loaded: ${hasOpenAiModelsLoaded(ctx)}`,
		`enabled: ${settings.enabled}`,
		`autoEnable: ${settings.autoEnable}`,
		`nativeProviderTools: ${settings.nativeProviderTools}`,
		"tools:",
		...Object.entries(capabilities).map(([name, capability]) => `- ${name}: ${capability.enabled ? "supported" : "disabled"}${active.has(name) ? ", active" : ""} — ${capability.reason}`),
	];
}

function registerDiagnosticCommand(pi: ExtensionAPI): void {
	pi.registerCommand("codex-minimal-tools", {
		description: "Show Codex Minimal Tools status and diagnostics.",
		getArgumentCompletions(prefix: string) {
			const items = [
				{ value: "doctor", label: "doctor", description: "Run lightweight self-checks" },
				{ value: "settings", label: "settings", description: "Explain extension-manager settings location" },
			];
			const query = prefix.trim().toLowerCase();
			const filtered = items.filter((item) => item.value.startsWith(query));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx) => {
			const subcommand = args.trim().split(/\s+/, 1)[0]?.toLowerCase();
			if (subcommand === "settings") {
				ctx.ui.notify("Codex Minimal Tools settings are under /extensions or /extension-settings when pi-extension-manager is installed. Config key: vstack.extensionManager.config[\"pi-codex-minimal-tools\"].", "info");
				return;
			}
			if (subcommand === "doctor") {
				const settings = loadSettings(ctx.cwd);
				const lines = statusLines(pi, ctx);
				lines.push(`image output dir: ${settings.imageOutputDir}`);
				lines.push(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "present" : "not set"}`);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			ctx.ui.notify(statusLines(pi, ctx).join("\n"), "info");
		},
	});
}

function registerTools(pi: ExtensionAPI): void {
	pi.registerTool(createImageGenerationToolDefinition({ loadSettings }) as never);
	pi.registerTool(createWebSearchToolDefinition() as never);
	pi.registerTool({
		name: "view_image",
		label: "View Image",
		description: "Inspect a local image file by returning image content to the model. Relative paths resolve against ctx.cwd; a leading @ is accepted.",
		promptSnippet: "Inspect local image files by path.",
		promptGuidelines: ["Use view_image when you need to inspect a local image file; pass the path in the path argument."],
		parameters: viewImageToolSchema,
		async execute(_toolCallId: string, params: ViewImageInput, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return viewImage(params, ctx.cwd) as never;
		},
	} as never);
	pi.registerTool(createApplyPatchToolDefinition({
		allowAbsolutePaths: (cwd) => loadSettings(cwd).allowAbsolutePatchPaths,
		deferRendering: loadSettings().deferApplyPatchRendering,
	}) as never);
}

export default function codexMinimalTools(pi: ExtensionAPI): void {
	const guard = pi as unknown as Record<PropertyKey, unknown>;
	if (guard[INSTALL_SYMBOL]) return;
	guard[INSTALL_SYMBOL] = true;

	let toolsRegistered = false;
	const ensureToolsRegistered = (ctx: ExtensionContext): boolean => {
		if (toolsRegistered) return true;
		const settings = loadSettings(ctx.cwd);
		if (!settings.enabled || !hasOpenAiModelsLoaded(ctx)) return false;
		if (settings.nativeProviderTools) installNativeAwareCodexProviderShim();
		registerTools(pi);
		toolsRegistered = true;
		return true;
	};

	registerDiagnosticCommand(pi);

	pi.on("session_start", async (_event, ctx) => syncActiveTools(pi, ctx, ensureToolsRegistered(ctx)));
	pi.on("model_select", async (_event, ctx) => syncActiveTools(pi, ctx, ensureToolsRegistered(ctx)));
	pi.on("thinking_level_select", async (_event, ctx) => syncActiveTools(pi, ctx, ensureToolsRegistered(ctx)));

	pi.on("before_provider_request", (event, ctx) => {
		const settings = loadSettings(ctx.cwd);
		if (!settings.enabled || !settings.nativeProviderTools || !hasOpenAiModelsLoaded(ctx) || contextModel(ctx)?.provider !== "openai-codex") return undefined;
		const result = rewriteNativeOpenAiTools(event.payload);
		return result.rewritten.length > 0 ? result.payload : undefined;
	});
}
