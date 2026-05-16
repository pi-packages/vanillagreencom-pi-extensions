import { appendActivityEvent } from "./append.ts";
import { resolveActivityPath } from "./paths.ts";
import type { ActivityEventInput } from "./types.ts";

export interface EmitContext {
	stateFile: string;
	sessionId?: string;
	tmuxSession?: string;
	stateDir?: string;
}

export function emitActivity(ctx: EmitContext, ev: ActivityEventInput): void {
	const file = resolveActivityPath(ctx);
	if (!file) return;
	try {
		appendActivityEvent(file, ev, { sessionId: ctx.sessionId ?? ctx.tmuxSession });
	} catch (err) {
		process.stderr.write(`flightdeck: activity emit failed: ${err instanceof Error ? err.message : String(err)}\n`);
	}
}
