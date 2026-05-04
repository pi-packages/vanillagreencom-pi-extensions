import type { ResolvedWebProvider, WebProvider, WebToolsSettings } from "./settings.js";

export interface ModelLike {
	provider?: string;
	id?: string;
	name?: string;
}

export interface ProviderAvailability {
	exaDirect: boolean;
	exaMcp: boolean;
	openAiNative: boolean;
	perplexity: boolean;
	geminiApi: boolean;
	geminiWeb: boolean;
}

export interface ProviderResolution {
	provider?: ResolvedWebProvider;
	reason: string;
}

export function isOpenAiNativeModel(model: ModelLike | undefined): boolean {
	const provider = (model?.provider ?? "").toLowerCase();
	return provider === "openai-codex" || provider === "openai" || provider.startsWith("openai-");
}

export function providerAvailability(settings: WebToolsSettings, model?: ModelLike): ProviderAvailability {
	return {
		exaDirect: Boolean(settings.apiKeys.exa),
		exaMcp: false,
		openAiNative: settings.nativeOpenAiWebSearch && isOpenAiNativeModel(model),
		perplexity: Boolean(settings.apiKeys.perplexity),
		geminiApi: Boolean(settings.apiKeys.gemini),
		geminiWeb: settings.browserCookieAccess,
	};
}

export function resolveWebProvider(requested: WebProvider | undefined, settings: WebToolsSettings, model?: ModelLike): ProviderResolution {
	const desired = requested ?? settings.defaultProvider;
	const enabled = new Set(settings.enabledProviders);
	const availability = providerAvailability(settings, model);
	const available = (provider: ResolvedWebProvider): boolean => {
		if (!enabled.has(provider)) return false;
		if (provider === "exa") return availability.exaDirect || availability.exaMcp;
		if (provider === "openai-native") return availability.openAiNative;
		if (provider === "perplexity") return availability.perplexity;
		if (provider === "gemini") return availability.geminiApi || availability.geminiWeb;
		return false;
	};
	if (desired !== "auto") {
		return available(desired) ? { provider: desired, reason: `${desired} available` } : { reason: `${desired} unavailable or disabled` };
	}
	for (const provider of ["exa", "openai-native", "perplexity", "gemini"] as const) {
		if (available(provider)) return { provider, reason: `auto selected ${provider}` };
	}
	return { reason: "no enabled provider has required credentials/capabilities" };
}

export function exaDeepResearchAvailable(settings: WebToolsSettings): boolean {
	return settings.enabled && settings.exaDeepResearchEnabled && settings.enabledProviders.includes("exa") && Boolean(settings.apiKeys.exa);
}
