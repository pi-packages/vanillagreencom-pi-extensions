import type { ModelLike } from "./capabilities.js";

export interface ModelRegistryLike {
	getAll?: () => unknown;
	getAvailable?: () => unknown;
	find?: (provider: string, id: string) => unknown;
}

export interface ActivationContextLike {
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
}

export function isOpenAiLoadedModel(model: ModelLike | undefined): boolean {
	const provider = (model?.provider ?? "").toLowerCase();
	return provider === "openai" || provider === "openai-codex" || provider.includes("openai");
}

function registryModels(registry: ModelRegistryLike | undefined): ModelLike[] {
	if (!registry) return [];
	for (const method of [registry.getAll, registry.getAvailable]) {
		if (typeof method !== "function") continue;
		try {
			const value = method.call(registry);
			if (Array.isArray(value)) return value.filter((model): model is ModelLike => Boolean(model) && typeof model === "object");
		} catch {
			// Try the next registry shape.
		}
	}
	return [];
}

export function hasOpenAiModelsLoaded(ctx: ActivationContextLike): boolean {
	if (isOpenAiLoadedModel(ctx.model)) return true;
	const models = registryModels(ctx.modelRegistry);
	if (models.some(isOpenAiLoadedModel)) return true;
	try {
		return Boolean(ctx.modelRegistry?.find?.("openai-codex", "gpt-5.5") || ctx.modelRegistry?.find?.("openai", "gpt-5.5"));
	} catch {
		return false;
	}
}
