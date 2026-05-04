import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export function setActivity(ctx: ExtensionContext, lines: string[] | undefined): void {
	ctx.ui?.setWidget?.("pi-web-tools.activity", lines, { placement: "belowEditor" });
}
