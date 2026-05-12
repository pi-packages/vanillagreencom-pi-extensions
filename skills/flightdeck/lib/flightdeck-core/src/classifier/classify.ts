import { PRE_FOOTER_RULES, POST_FOOTER_RULES, FOOTER_GATE, IDLE_CURSOR } from "./rules.ts";

export interface ClassifyResult {
	tag: string;
	matched: string;
}

export interface ClassifyOptions {
	noFooterGate?: boolean;
}

// Mirrors scripts/prompt-classify control flow exactly:
//   1. pre-footer sentinels (awaiting-direction)
//   2. footer gate (unless disabled) — returns rendering or idle on miss
//   3. post-footer specific sentinels (priority order, first match wins)
//   4. fallback: idle
export function classifyBuffer(buf: string, options: ClassifyOptions = {}): ClassifyResult {
	for (const rule of PRE_FOOTER_RULES) {
		if (rule.pattern.test(buf)) return { matched: rule.matched, tag: rule.tag };
	}

	if (!options.noFooterGate) {
		if (!FOOTER_GATE.test(buf)) {
			if (IDLE_CURSOR.test(buf)) return { matched: "", tag: "idle" };
			return { matched: "", tag: "rendering" };
		}
	}

	for (const rule of POST_FOOTER_RULES) {
		if (rule.pattern.test(buf)) return { matched: rule.matched, tag: rule.tag };
	}

	return { matched: "", tag: "idle" };
}
