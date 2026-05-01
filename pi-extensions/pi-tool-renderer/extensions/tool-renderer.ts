import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const INSTALL_SYMBOL = Symbol.for("vstack.pi-tool-renderer.installed");
const USER_MESSAGE_PATCH_SYMBOL = Symbol.for("vstack.pi-tool-renderer.user-message-patch");
const USER_MESSAGE_BOX_STATE_SYMBOL = Symbol.for("vstack.pi-tool-renderer.user-message-box-state");

const USER_MESSAGE_BG_TOKENS = new Set(["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);

type VstackConfig = Record<string, unknown>;

function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

function projectSettingsPath(cwd: string): string {
	let current = resolve(cwd);
	while (true) {
		const candidate = join(current, ".pi", "settings.json");
		if (existsSync(candidate)) return candidate;
		if (existsSync(join(current, ".pi")) || existsSync(join(current, ".git")) || existsSync(join(current, ".vstack-lock.json"))) return candidate;
		const parent = dirname(current);
		if (parent === current) return join(resolve(cwd), ".pi", "settings.json");
		current = parent;
	}
}

function piSettingsPaths(cwd = process.cwd()): string[] {
	const userDir = resolve(expandHome(process.env.PI_CODING_AGENT_DIR?.trim() || "~/.pi/agent"));
	return [join(userDir, "settings.json"), projectSettingsPath(cwd)];
}

function readVstackConfig(cwd?: string): VstackConfig {
	const merged: VstackConfig = {};
	for (const path of piSettingsPaths(cwd)) {
		if (!existsSync(path)) continue;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8"));
			const config = parsed?.vstack?.extensionManager?.config?.["pi-tool-renderer"];
			if (config && typeof config === "object" && !Array.isArray(config)) Object.assign(merged, config);
		} catch {
			// Ignore malformed optional manager config.
		}
	}
	return merged;
}

function settingNumber(key: string, fallback: number, cwd?: string): number {
	const value = readVstackConfig(cwd)[key];
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

function settingBoolean(key: string, fallback: boolean, cwd?: string): boolean {
	const value = readVstackConfig(cwd)[key];
	return typeof value === "boolean" ? value : fallback;
}

function settingString(key: string, fallback: string, cwd?: string): string {
	const value = readVstackConfig(cwd)[key];
	return typeof value === "string" ? value : fallback;
}

function userMessageBackgroundToken(cwd?: string): string {
	const token = settingString("userMessageBackground", "customMessageBg", cwd);
	return USER_MESSAGE_BG_TOKENS.has(token) ? token : "customMessageBg";
}

function lineCount(text: string): number {
	if (!text) return 0;
	return text.split(/\r?\n/).length;
}

function textContent(result: any): string {
	const part = result?.content?.find?.((candidate: any) => candidate?.type === "text" && typeof candidate.text === "string");
	return part?.text ?? "";
}

function clipLine(line: string, cwd?: string): string {
	const max = Math.max(40, Math.floor(settingNumber("maxLineWidth", 1000, cwd)));
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function preview(text: string, count: number, direction: "head" | "tail", cwd?: string): string {
	const lines = text.split(/\r?\n/);
	const selected = direction === "head" ? lines.slice(0, count) : lines.slice(-count);
	return selected.map((line) => clipLine(line, cwd)).join("\n");
}

function commandExit(text: string): number | null {
	const match = text.match(/exit code:\s*(\d+)/i) ?? text.match(/exit\s+(\d+)/i);
	return match ? Number.parseInt(match[1]!, 10) : null;
}

function diffStats(diff: string): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const line of diff.split(/\r?\n/)) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
		if (line.startsWith("-") && !line.startsWith("---")) removals += 1;
	}
	return { additions, removals };
}

function truncatedMarker(text: string): boolean {
	return /^\s*\[(?:Output|Full output|Read output|Search output|Bash output)[^\n\]]*truncated|^\s*\[[^\n\]]*Full output saved to:/im.test(text);
}

function resultTruncated(result: any): boolean {
	const details = result?.details;
	if (typeof details?.truncation?.truncated === "boolean") return details.truncation.truncated;
	if (typeof details?.truncated === "boolean") return details.truncated;
	return truncatedMarker(textContent(result));
}

function makeText(text: string): Text {
	return new Text(text, 0, 0);
}

function makeEmpty() {
	return {
		invalidate() {},
		render(): string[] {
			return [];
		},
	};
}

interface UserMessagePatchState {
	activeCtx?: ExtensionContext;
	originalRender: (width: number) => string[];
}

function installUserMessageRenderer(pi: ExtensionAPI, UserMessageComponent: any): void {
	const prototype = UserMessageComponent?.prototype as Record<PropertyKey, unknown> | undefined;
	if (!prototype || typeof prototype.render !== "function") return;

	let state = prototype[USER_MESSAGE_PATCH_SYMBOL] as UserMessagePatchState | undefined;
	if (!state) {
		state = {
			originalRender: prototype.render as (width: number) => string[],
		};
		prototype[USER_MESSAGE_PATCH_SYMBOL] = state;
		prototype.render = function compactUserMessageRender(this: any, width: number): string[] {
			const box = this?.contentBox;
			const ctx = state?.activeCtx;
			if (box && ctx?.hasUI) {
				const cwd = ctx.cwd ?? process.cwd();
				const compact = settingBoolean("compactUserMessages", true, cwd);
				const paddingY = compact ? 0 : 1;
				const backgroundToken = compact ? userMessageBackgroundToken(cwd) : "userMessageBg";
				const boxState = `${paddingY}:${backgroundToken}`;

				if (box[USER_MESSAGE_BOX_STATE_SYMBOL] !== boxState) {
					box.paddingY = paddingY;
					box.setBgFn?.((content: string) => {
						const theme = state?.activeCtx?.ui?.theme;
						if (!theme?.bg) return content;
						try {
							return theme.bg(backgroundToken as any, content);
						} catch {
							return theme.bg("userMessageBg", content);
						}
					});
					box.invalidateCache?.();
					box[USER_MESSAGE_BOX_STATE_SYMBOL] = boxState;
				}
			}

			return state!.originalRender.call(this, width);
		};
	}

	pi.on("session_start", (_event: any, ctx: ExtensionContext) => {
		state!.activeCtx = ctx;
	});
	pi.on("session_shutdown", () => {
		if (prototype[USER_MESSAGE_PATCH_SYMBOL] === state) {
			prototype.render = state!.originalRender as unknown;
			delete prototype[USER_MESSAGE_PATCH_SYMBOL];
		}
		state!.activeCtx = undefined;
	});
}

class TruncatedLines {
	private cachedLines?: string[];
	private cachedWidth?: number;
	private readonly lines: string[];

	constructor(text: string) {
		this.lines = text ? text.split(/\r?\n/) : [];
	}

	invalidate(): void {
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const targetWidth = Math.max(1, width);
		const lines = this.lines.map((line) => truncateToWidth(line, targetWidth));
		this.cachedLines = lines;
		this.cachedWidth = width;
		return lines;
	}
}

function makeTruncatedLines(text: string): TruncatedLines {
	return new TruncatedLines(text);
}

function stackToolCalls(cwd?: string): boolean {
	return settingBoolean("stackToolCalls", false, cwd);
}

type StackChildDisplay = "rows" | "headline" | "anchor-list";

function stackChildDisplay(cwd?: string): StackChildDisplay {
	const value = readVstackConfig(cwd).stackChildDisplay;
	if (value === "rows" || value === "headline" || value === "anchor-list") return value;
	return settingBoolean("hideStackChildRows", false, cwd) ? "headline" : "rows";
}

function stackShell(cwd?: string): { renderShell?: "self" } {
	return stackToolCalls(cwd) ? { renderShell: "self" } : {};
}

function stackPrefix(theme: any): string {
	return theme.fg("accent", "● ");
}

function toolRule(theme: any, text: string): string {
	try {
		return theme.fg("borderMuted", text);
	} catch {
		return theme.fg("muted", text);
	}
}

function treeConnector(theme: any, branch: "├" | "└" | "│" = "├"): string {
	if (branch === "│") return toolRule(theme, "  │ ");
	return toolRule(theme, `  ${branch}─ `);
}

function toolLabel(theme: any, label: string): string {
	return theme.fg("text", theme.bold(label));
}

function readCallText(args: any, theme: any): string {
	const range = args?.offset || args?.limit ? `:${args.offset ?? 1}${args.limit ? `-${Number(args.offset ?? 1) + Number(args.limit) - 1}` : ""}` : "";
	return `${toolLabel(theme, "Read ")}${theme.fg("accent", `${args?.path ?? ""}${range}`)}`;
}

function bashCallText(args: any, theme: any, cwd?: string): string {
	const max = Math.max(20, Math.floor(settingNumber("commandPreviewChars", 96, cwd)));
	const command = args?.command && args.command.length > max ? `${args.command.slice(0, max - 1)}…` : args?.command;
	return `${toolLabel(theme, "Bash $ ")}${theme.fg("accent", command ?? "")}`;
}

function readOnlyCallText(toolName: string, args: any, theme: any, cwd?: string): string {
	const query = args?.pattern ?? args?.glob ?? args?.path ?? args?.query ?? "";
	return `${toolLabel(theme, `${toolName} `)}${theme.fg("accent", clipLine(String(query), cwd))}`;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const DIFF_RESET = "\x1b[0m";
const DIFF_BG_ADD = "\x1b[48;2;18;48;31m";
const DIFF_BG_DEL = "\x1b[48;2;54;24;27m";
const DIFF_BG_CTX = "\x1b[49m";
const DIFF_FG_ADD = "\x1b[38;2;110;220;145m";
const DIFF_FG_DEL = "\x1b[38;2;235;120;120m";
const DIFF_FG_DIM = "\x1b[38;2;130;135;145m";
const DIFF_FG_RULE = "\x1b[38;2;72;76;86m";
const DIFF_FG_NUM = "\x1b[38;2;105;112;125m";
const DIFF_SPLIT_MIN_WIDTH = 132;
const DIFF_LCS_CELL_LIMIT = 250_000;
const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_INPUT_BYTES = 700 * 1024;

type DiffKind = "ctx" | "add" | "del" | "sep";
interface StructuredDiffLine {
	content: string;
	newNum: number | null;
	oldNum: number | null;
	type: DiffKind;
}
interface StructuredDiff {
	additions: number;
	chars: number;
	lines: StructuredDiffLine[];
	removals: number;
}

interface BlinkEntry {
	invalidate: () => void;
}

const blinkEntries = new Map<unknown, BlinkEntry>();
let blinkTimer: ReturnType<typeof setInterval> | undefined;

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function visibleLength(text: string): number {
	return stripAnsi(text).length;
}

function padVisible(text: string, width: number): string {
	const missing = width - visibleLength(text);
	return missing > 0 ? `${text}${" ".repeat(missing)}` : text;
}

function terminalWidth(): number {
	const raw = Number(process.stdout.columns || (process.stderr as any).columns || process.env.COLUMNS || 120);
	return Math.max(60, Math.min(raw - 4, 220));
}

function truncateAnsi(text: string, width: number): string {
	return truncateToWidth(text, Math.max(1, width), "");
}

function blinkKey(context: any): unknown {
	return context?.toolCallId ?? context?.id ?? context;
}

function startBlinkTimer(): void {
	if (blinkTimer) return;
	blinkTimer = setInterval(() => {
		for (const entry of blinkEntries.values()) {
			try {
				entry.invalidate();
			} catch {
				// Rendering invalidation is best-effort only.
			}
		}
		if (blinkEntries.size === 0 && blinkTimer) {
			clearInterval(blinkTimer);
			blinkTimer = undefined;
		}
	}, 450);
	blinkTimer.unref?.();
}

function trackBlink(context: any): void {
	const key = blinkKey(context);
	if (!key || typeof context?.invalidate !== "function") return;
	blinkEntries.set(key, { invalidate: () => context.invalidate() });
	startBlinkTimer();
}

function clearBlink(context: any): void {
	const key = blinkKey(context);
	if (key) blinkEntries.delete(key);
	if (blinkEntries.size === 0 && blinkTimer) {
		clearInterval(blinkTimer);
		blinkTimer = undefined;
	}
}

function blinkingPrefix(theme: any, context: any): string {
	trackBlink(context);
	const on = Math.floor(Date.now() / 450) % 2 === 0;
	return theme.fg(on ? "success" : "muted", on ? "● " : "○ ");
}

const NF_DIR = "\x1b[38;2;100;140;220m\x1b[0m";
const NF_FILE = "\x1b[38;2;130;130;130m\x1b[0m";
const ICON_BY_NAME: Record<string, string> = {
	"dockerfile": "\x1b[38;2;56;152;236m\x1b[0m",
	"license": "\x1b[38;2;218;218;218m\x1b[0m",
	"makefile": "\x1b[38;2;130;130;130m\x1b[0m",
	"package.json": "\x1b[38;2;137;180;130m\x1b[0m",
	"readme.md": "\x1b[38;2;66;165;245m󰂺\x1b[0m",
	"tsconfig.json": "\x1b[38;2;49;120;198m\x1b[0m",
};
const ICON_BY_EXT: Record<string, string> = {
	bash: "\x1b[38;2;137;180;130m\x1b[0m",
	c: "\x1b[38;2;85;154;211m\x1b[0m",
	cpp: "\x1b[38;2;85;154;211m\x1b[0m",
	css: "\x1b[38;2;66;165;245m\x1b[0m",
	gif: "\x1b[38;2;160;116;196m\x1b[0m",
	go: "\x1b[38;2;0;173;216m\x1b[0m",
	graphql: "\x1b[38;2;224;51;144m󰡷\x1b[0m",
	html: "\x1b[38;2;228;77;38m\x1b[0m",
	java: "\x1b[38;2;204;62;68m\x1b[0m",
	jpg: "\x1b[38;2;160;116;196m\x1b[0m",
	jpeg: "\x1b[38;2;160;116;196m\x1b[0m",
	js: "\x1b[38;2;241;224;90m\x1b[0m",
	json: "\x1b[38;2;241;224;90m\x1b[0m",
	jsx: "\x1b[38;2;97;218;251m\x1b[0m",
	lock: "\x1b[38;2;130;130;130m\x1b[0m",
	lua: "\x1b[38;2;81;160;207m\x1b[0m",
	md: "\x1b[38;2;66;165;245m󰍔\x1b[0m",
	png: "\x1b[38;2;160;116;196m\x1b[0m",
	py: "\x1b[38;2;55;118;171m\x1b[0m",
	rb: "\x1b[38;2;204;52;45m\x1b[0m",
	rs: "\x1b[38;2;222;165;132m\x1b[0m",
	scss: "\x1b[38;2;207;100;154m\x1b[0m",
	sh: "\x1b[38;2;137;180;130m\x1b[0m",
	sql: "\x1b[38;2;218;218;218m\x1b[0m",
	svg: "\x1b[38;2;255;180;50m󰜡\x1b[0m",
	svelte: "\x1b[38;2;255;62;0m\x1b[0m",
	toml: "\x1b[38;2;160;116;196m\x1b[0m",
	ts: "\x1b[38;2;49;120;198m\x1b[0m",
	tsx: "\x1b[38;2;49;120;198m\x1b[0m",
	vue: "\x1b[38;2;65;184;131m\x1b[0m",
	xml: "\x1b[38;2;228;77;38m󰗀\x1b[0m",
	yaml: "\x1b[38;2;160;116;196m\x1b[0m",
	yml: "\x1b[38;2;160;116;196m\x1b[0m",
	zsh: "\x1b[38;2;137;180;130m\x1b[0m",
};

function nerdIcon(pathText: string, isDirectory = false): string {
	if (isDirectory) return NF_DIR;
	const clean = stripAnsi(pathText).trim().replace(/\/$/, "");
	const name = basename(clean).toLowerCase();
	if (ICON_BY_NAME[name]) return ICON_BY_NAME[name];
	const ext = extname(name).replace(/^\./, "").toLowerCase();
	return ICON_BY_EXT[ext] ?? NF_FILE;
}

function renderPathListPreview(output: string, toolName: "find" | "ls", theme: any, expanded: boolean, cwd?: string): string {
	const rawItems = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (rawItems.length === 0) return theme.fg("muted", toolName === "ls" ? "empty directory" : "no files found");
	const limit = Math.max(1, Math.floor(settingNumber("searchPreviewLines", 80, cwd)));
	const shown = rawItems.slice(0, expanded ? limit : Math.min(limit, 12));
	const lines = shown.map((item, index) => {
		const clean = stripAnsi(item).trim();
		const isDir = clean.endsWith("/");
		const branch = index === shown.length - 1 && shown.length === rawItems.length ? "└" : "├";
		const icon = nerdIcon(clean, isDir);
		const label = isDir ? theme.fg("accent", theme.bold(clean)) : theme.fg("dim", clean);
		return `${treeConnector(theme, branch as "├" | "└")}${icon} ${label}`;
	});
	const remaining = rawItems.length - shown.length;
	if (remaining > 0) {
		const noun = toolName === "ls" ? (remaining === 1 ? "entry" : "entries") : `file${remaining === 1 ? "" : "s"}`;
		lines.push(`${treeConnector(theme, "└")}${theme.fg("muted", `… ${remaining} more ${noun}`)}`);
	}
	return lines.join("\n");
}

function splitContentLines(text: string): string[] {
	if (!text) return [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function diffOps(oldLines: string[], newLines: string[]): Array<{ text: string; type: "ctx" | "add" | "del" }> {
	let start = 0;
	while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
	let oldEnd = oldLines.length - 1;
	let newEnd = newLines.length - 1;
	while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
		oldEnd--;
		newEnd--;
	}
	const ops: Array<{ text: string; type: "ctx" | "add" | "del" }> = [];
	for (let i = 0; i < start; i++) ops.push({ text: oldLines[i] ?? "", type: "ctx" });
	const oldMid = oldLines.slice(start, oldEnd + 1);
	const newMid = newLines.slice(start, newEnd + 1);
	if (oldMid.length * newMid.length > DIFF_LCS_CELL_LIMIT) {
		for (const text of oldMid) ops.push({ text, type: "del" });
		for (const text of newMid) ops.push({ text, type: "add" });
	} else {
		const m = oldMid.length;
		const n = newMid.length;
		const width = n + 1;
		const table = new Uint32Array((m + 1) * (n + 1));
		for (let i = m - 1; i >= 0; i--) {
			for (let j = n - 1; j >= 0; j--) {
				table[i * width + j] = oldMid[i] === newMid[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < m && j < n) {
			if (oldMid[i] === newMid[j]) {
				ops.push({ text: oldMid[i] ?? "", type: "ctx" });
				i++;
				j++;
			} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
				ops.push({ text: oldMid[i] ?? "", type: "del" });
				i++;
			} else {
				ops.push({ text: newMid[j] ?? "", type: "add" });
				j++;
			}
		}
		while (i < m) ops.push({ text: oldMid[i++] ?? "", type: "del" });
		while (j < n) ops.push({ text: newMid[j++] ?? "", type: "add" });
	}
	for (let i = oldEnd + 1; i < oldLines.length; i++) ops.push({ text: oldLines[i] ?? "", type: "ctx" });
	return ops;
}

function hiddenDiffLine(count: number): StructuredDiffLine {
	return {
		content: `… ${count} unchanged line${count === 1 ? "" : "s"} …`,
		newNum: null,
		oldNum: null,
		type: "sep",
	};
}

function compactStructuredDiffLines(lines: StructuredDiffLine[], contextLines = DIFF_CONTEXT_LINES): StructuredDiffLine[] {
	const changed = lines
		.map((line, index) => (line.type === "add" || line.type === "del" ? index : -1))
		.filter((index) => index >= 0);
	if (changed.length === 0) return lines;

	const ranges: Array<{ end: number; start: number }> = [];
	for (const index of changed) {
		const start = Math.max(0, index - contextLines);
		const end = Math.min(lines.length - 1, index + contextLines);
		const previous = ranges[ranges.length - 1];
		if (!previous || start > previous.end + 1) ranges.push({ start, end });
		else previous.end = Math.max(previous.end, end);
	}

	const compacted: StructuredDiffLine[] = [];
	let previousEnd = -1;
	for (const range of ranges) {
		const hidden = range.start - previousEnd - 1;
		if (hidden > 0) compacted.push(hiddenDiffLine(hidden));
		compacted.push(...lines.slice(range.start, range.end + 1));
		previousEnd = range.end;
	}
	const trailingHidden = lines.length - previousEnd - 1;
	if (trailingHidden > 0) compacted.push(hiddenDiffLine(trailingHidden));
	return compacted;
}

function buildStructuredDiff(oldText: string, newText: string): StructuredDiff {
	const ops = diffOps(splitContentLines(oldText), splitContentLines(newText));
	let oldNum = 1;
	let newNum = 1;
	let additions = 0;
	let removals = 0;
	const lines: StructuredDiffLine[] = [];
	for (const op of ops) {
		if (op.type === "ctx") {
			lines.push({ content: op.text, newNum, oldNum, type: "ctx" });
			oldNum++;
			newNum++;
		} else if (op.type === "del") {
			lines.push({ content: op.text, newNum: null, oldNum, type: "del" });
			oldNum++;
			removals++;
		} else {
			lines.push({ content: op.text, newNum, oldNum: null, type: "add" });
			newNum++;
			additions++;
		}
	}
	return { additions, chars: oldText.length + newText.length, lines: compactStructuredDiffLines(lines), removals };
}

function diffStatBar(additions: number, removals: number): string {
	const total = additions + removals;
	if (total <= 0) return "";
	const slots = Math.max(6, Math.min(18, Math.ceil(total / 3)));
	let addSlots = Math.round((additions / total) * slots);
	if (additions > 0 && addSlots === 0) addSlots = 1;
	if (removals > 0 && addSlots === slots) addSlots = slots - 1;
	const delSlots = slots - addSlots;
	return `${DIFF_FG_DIM}[${DIFF_RESET}${DIFF_FG_ADD}${"━".repeat(addSlots)}${DIFF_FG_DEL}${"━".repeat(delSlots)}${DIFF_RESET}${DIFF_FG_DIM}]${DIFF_RESET}`;
}

function diffSummary(diff: StructuredDiff, theme: any): string {
	const parts: string[] = [];
	if (diff.additions > 0) parts.push(theme.fg("success", `+${diff.additions}`));
	if (diff.removals > 0) parts.push(theme.fg("error", `-${diff.removals}`));
	if (parts.length === 0) return theme.fg("muted", "no changes");
	const bar = diffStatBar(diff.additions, diff.removals);
	return `${parts.join(" ")}${bar ? ` ${bar}` : ""}`;
}

function colorDiffText(line: StructuredDiffLine, text: string): string {
	if (line.type === "add") return `${DIFF_BG_ADD}${DIFF_FG_ADD}${text}${DIFF_RESET}`;
	if (line.type === "del") return `${DIFF_BG_DEL}${DIFF_FG_DEL}${text}${DIFF_RESET}`;
	if (line.type === "sep") return `${DIFF_FG_DIM}${text}${DIFF_RESET}`;
	return `${DIFF_BG_CTX}${DIFF_FG_DIM}${text}${DIFF_RESET}`;
}

function formatNum(value: number | null, width: number): string {
	return value === null ? " ".repeat(width) : `${" ".repeat(Math.max(0, width - String(value).length))}${value}`;
}

function renderUnifiedDiff(diff: StructuredDiff, rows: StructuredDiffLine[], width: number): string[] {
	const maxNum = Math.max(1, ...diff.lines.map((line) => Math.max(line.oldNum ?? 0, line.newNum ?? 0)));
	const numWidth = Math.max(2, String(maxNum).length);
	return rows.map((line) => {
		const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
		const gutter = `${DIFF_FG_NUM}${formatNum(line.oldNum, numWidth)} ${formatNum(line.newNum, numWidth)}${DIFF_RESET} ${line.type === "add" ? DIFF_FG_ADD : line.type === "del" ? DIFF_FG_DEL : DIFF_FG_DIM}${sign}${DIFF_RESET} `;
		const contentWidth = Math.max(10, width - visibleLength(gutter));
		return `${gutter}${truncateAnsi(colorDiffText(line, line.content || " "), contentWidth)}`;
	});
}

function pairDiffRows(rows: StructuredDiffLine[]): Array<{ left: StructuredDiffLine | null; right: StructuredDiffLine | null }> {
	const paired: Array<{ left: StructuredDiffLine | null; right: StructuredDiffLine | null }> = [];
	let index = 0;
	while (index < rows.length) {
		const line = rows[index]!;
		if (line.type === "ctx" || line.type === "sep") {
			paired.push({ left: line, right: line });
			index++;
			continue;
		}
		const dels: StructuredDiffLine[] = [];
		const adds: StructuredDiffLine[] = [];
		while (index < rows.length && rows[index]!.type === "del") dels.push(rows[index++]!);
		while (index < rows.length && rows[index]!.type === "add") adds.push(rows[index++]!);
		const count = Math.max(dels.length, adds.length);
		for (let i = 0; i < count; i++) paired.push({ left: dels[i] ?? null, right: adds[i] ?? null });
	}
	return paired;
}

function renderDiffHalf(line: StructuredDiffLine | null, side: "old" | "new", width: number, numWidth: number): string {
	if (!line) return " ".repeat(width);
	const num = side === "old" ? line.oldNum : line.newNum;
	const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
	const raw = `${formatNum(num, numWidth)} ${sign} ${line.content || " "}`;
	return padVisible(truncateAnsi(colorDiffText(line, raw), width), width);
}

function renderSplitDiff(diff: StructuredDiff, rows: StructuredDiffLine[], width: number): string[] {
	const maxNum = Math.max(1, ...diff.lines.map((line) => Math.max(line.oldNum ?? 0, line.newNum ?? 0)));
	const numWidth = Math.max(2, String(maxNum).length);
	const divider = `${DIFF_FG_RULE}│${DIFF_RESET}`;
	const half = Math.max(24, Math.floor((width - visibleLength(divider)) / 2));
	const header = `${padVisible(`${DIFF_FG_DIM}old${DIFF_RESET}`, half)}${divider}${DIFF_FG_DIM}new${DIFF_RESET}`;
	const rule = `${DIFF_FG_RULE}${"─".repeat(half)}${DIFF_RESET}${divider}${DIFF_FG_RULE}${"─".repeat(half)}${DIFF_RESET}`;
	const out = [header, rule];
	for (const pair of pairDiffRows(rows)) {
		out.push(`${renderDiffHalf(pair.left, "old", half, numWidth)}${divider}${renderDiffHalf(pair.right, "new", half, numWidth)}`);
	}
	out.push(rule);
	return out;
}

function renderStructuredDiff(diff: StructuredDiff, theme: any, expanded: boolean, cwd?: string): string {
	if (diff.additions === 0 && diff.removals === 0) return theme.fg("muted", "no changes");
	const width = terminalWidth();
	const fallbackLimit = expanded ? 4000 : 24;
	const configuredLimit = Math.floor(settingNumber(expanded ? "diffExpandedLines" : "diffPreviewLines", fallbackLimit, cwd));
	const maxRows = expanded && configuredLimit <= 0 ? diff.lines.length : Math.max(4, configuredLimit);
	const rows = diff.lines.slice(0, maxRows);
	const useSplit = settingBoolean("splitDiffs", true, cwd) && width >= DIFF_SPLIT_MIN_WIDTH;
	const rendered = useSplit ? renderSplitDiff(diff, rows, width) : renderUnifiedDiff(diff, rows, width);
	const remaining = diff.lines.length - rows.length;
	if (remaining > 0) rendered.push(`${DIFF_FG_DIM}… ${remaining} more diff line(s)${expanded ? ` · UI cap ${rows.length}/${diff.lines.length}` : " · Ctrl+O to expand"}${DIFF_RESET}`);
	return rendered.join("\n");
}

function readTextForDiff(pathValue: unknown, cwd: string): string | undefined {
	if (typeof pathValue !== "string" || !pathValue.trim()) return undefined;
	const target = resolve(cwd, pathValue);
	try {
		if (!existsSync(target)) return undefined;
		const text = readFileSync(target, "utf8");
		return Buffer.byteLength(text, "utf8") <= MAX_DIFF_INPUT_BYTES ? text : undefined;
	} catch {
		return undefined;
	}
}

function attachDiffDetails(result: any, before: string | undefined, after: string | undefined): any {
	if (before === undefined && after === undefined) return result;
	const oldText = before ?? "";
	const newText = after ?? "";
	if (oldText === newText) return result;
	const diff = buildStructuredDiff(oldText, newText);
	const extra = { vstackDiff: diff, vstackDiffWasNewFile: before === undefined };
	result.details = result?.details && typeof result.details === "object" ? { ...result.details, ...extra } : extra;
	return result;
}

type StackableToolName = "read" | "bash" | "grep" | "find" | "ls";
type StackItemStatus = "running" | "done" | "error";

interface StackItem {
	args: any;
	batchId: string;
	id: string;
	isError: boolean;
	resultText: string;
	status: StackItemStatus;
	toolName: StackableToolName;
	truncated: boolean;
}

interface StackBatch {
	anchorId: string;
	id: string;
	items: string[];
	updatedAt: number;
}

const STACKABLE_TOOLS = new Set<string>(["read", "bash", "grep", "find", "ls"]);
const stackItems = new Map<string, StackItem>();
const stackBatches = new Map<string, StackBatch>();
const stackInvalidators = new Map<string, () => void>();
let currentStackBatch: StackBatch | null = null;
let stackBatchCounter = 0;

function isStackableToolName(toolName: unknown): toolName is StackableToolName {
	return typeof toolName === "string" && STACKABLE_TOOLS.has(toolName);
}

function notifyStackBatch(batchId: string): void {
	const batch = stackBatches.get(batchId);
	if (!batch) return;
	for (const id of batch.items) stackInvalidators.get(id)?.();
}

function createStackBatch(firstId: string): StackBatch {
	const batch: StackBatch = { anchorId: firstId, id: `stack-${++stackBatchCounter}`, items: [], updatedAt: Date.now() };
	stackBatches.set(batch.id, batch);
	currentStackBatch = batch;
	return batch;
}

function ensureStackItem(toolName: StackableToolName, id: string, args: any): StackItem {
	const existing = stackItems.get(id);
	if (existing) {
		existing.args = args ?? existing.args;
		return existing;
	}
	const batch = currentStackBatch ?? createStackBatch(id);
	if (!batch.items.includes(id)) batch.items.push(id);
	const item: StackItem = { args, batchId: batch.id, id, isError: false, resultText: "", status: "running", toolName, truncated: false };
	stackItems.set(id, item);
	batch.updatedAt = Date.now();
	notifyStackBatch(batch.id);
	return item;
}

function contextToolCallId(context: any, toolName: string, args: any): string {
	return String(context?.toolCallId ?? context?.id ?? `${toolName}:${JSON.stringify(args ?? {})}`);
}

function stackItemCallText(item: StackItem, theme: any, cwd?: string): string {
	if (item.toolName === "read") return readCallText(item.args, theme);
	if (item.toolName === "bash") return bashCallText(item.args, theme, cwd);
	return readOnlyCallText(item.toolName, item.args, theme, cwd);
}

function stackItemSummary(item: StackItem, theme: any): string {
	if (item.status === "running") return theme.fg("warning", "running");
	if (item.isError) return theme.fg("error", "failed");
	if (item.toolName === "read") {
		const count = lineCount(item.resultText);
		let text = theme.fg("success", `${count} line${count === 1 ? "" : "s"}`);
		if (item.truncated) text += theme.fg("warning", " · truncated");
		return text;
	}
	if (item.toolName === "bash") {
		const exit = commandExit(item.resultText);
		const count = lineCount(item.resultText);
		const exitLabel = exit === null ? "exit 0" : `exit ${exit}`;
		let text = exit !== null && exit !== 0 ? theme.fg("error", exitLabel) : theme.fg("success", exitLabel);
		text += theme.fg("dim", ` · ${count} line${count === 1 ? "" : "s"}`);
		if (item.truncated) text += theme.fg("warning", " · truncated");
		return text;
	}
	const count = item.resultText.trim() ? lineCount(item.resultText) : 0;
	let text = theme.fg("success", `${count} result${count === 1 ? "" : "s"}`);
	if (item.truncated) text += theme.fg("warning", " · truncated");
	return text;
}

function stackItemPreview(item: StackItem, theme: any, expanded: boolean, cwd?: string): string {
	if (!item.resultText || item.status === "running") return "";
	if (item.toolName === "find" || item.toolName === "ls") return renderPathListPreview(item.resultText, item.toolName, theme, expanded, cwd);
	if (item.toolName === "bash") return preview(item.resultText, Math.max(1, Math.floor(settingNumber("bashPreviewLines", 80, cwd))), "tail", cwd);
	if (item.toolName === "read") return preview(item.resultText, Math.max(1, Math.floor(settingNumber("readPreviewLines", 80, cwd))), "head", cwd);
	return preview(item.resultText, Math.max(1, Math.floor(settingNumber("searchPreviewLines", 80, cwd))), "head", cwd);
}

function renderStackItemText(item: StackItem, theme: any, expanded: boolean, cwd?: string, branch = "├"): string {
	const isLast = branch === "└";
	const stem = isLast ? theme.fg("muted", "     ") : treeConnector(theme, "│");
	let text = `${treeConnector(theme, branch as "├" | "└")}${stackItemCallText(item, theme, cwd)}${theme.fg("dim", " · ")}${stackItemSummary(item, theme)}`;
	if (expanded) {
		const previewText = stackItemPreview(item, theme, expanded, cwd);
		if (previewText) {
			const lines = previewText.split(/\r?\n/).map((line) => `${stem}${theme.fg("dim", line)}`);
			text += `\n${lines.join("\n")}`;
		}
	}
	return text;
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralText}`;
}

function joinPhrases(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? "";
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function stackBatchHeadline(batch: StackBatch, theme: any, expanded: boolean, childDisplay: StackChildDisplay): string {
	const items = batch.items.map((id) => stackItems.get(id)).filter(Boolean) as StackItem[];
	const running = items.some((item) => item.status === "running");
	const done = items.filter((item) => item.status !== "running").length;
	const reads = items.filter((item) => item.toolName === "read").length;
	const shells = items.filter((item) => item.toolName === "bash").length;
	const searches = items.filter((item) => item.toolName === "grep" || item.toolName === "find" || item.toolName === "ls").length;
	const phrases: string[] = [];
	if (reads > 0) phrases.push(`${running ? "reading" : "read"} ${plural(reads, "file")}`);
	if (shells > 0) phrases.push(`${running ? "running" : "ran"} ${plural(shells, "shell command")}`);
	if (searches > 0) phrases.push(`${running ? "searching/listing" : "searched/listed"} ${plural(searches, "time")}`);
	const lead = joinPhrases(phrases) || (running ? "running tools" : "ran tools");
	const sentence = lead.charAt(0).toUpperCase() + lead.slice(1);
	const progress = running ? theme.fg("warning", ` · ${done}/${items.length} done`) : theme.fg("success", " · done");
	const expandHint = childDisplay === "headline" && !expanded && items.length > 0 ? theme.fg("dim", " · Ctrl+O to expand") : "";
	return `${stackPrefix(theme)}${sentence}${running ? "…" : ""}${progress}${expandHint}`;
}

function renderStackBatch(batch: StackBatch, theme: any, expanded: boolean, cwd?: string, childDisplay: StackChildDisplay = "rows"): TruncatedLines {
	let text = stackBatchHeadline(batch, theme, expanded, childDisplay);
	if (childDisplay === "anchor-list" || (childDisplay === "headline" && expanded)) {
		const items = batch.items.map((id) => stackItems.get(id)).filter(Boolean) as StackItem[];
		items.forEach((item, index) => {
			text += `\n${renderStackItemText(item, theme, expanded, cwd, index === items.length - 1 ? "└" : "├")}`;
		});
	}
	return makeTruncatedLines(text);
}

function renderStackedToolResult(toolName: StackableToolName, result: any, isPartial: boolean, expanded: boolean, theme: any, context: any, cwd: string) {
	const id = contextToolCallId(context, toolName, context?.args);
	const item = ensureStackItem(toolName, id, context?.args ?? {});
	if (context?.invalidate) stackInvalidators.set(id, context.invalidate);
	if (!isPartial) {
		item.status = context?.isError ? "error" : "done";
		item.isError = Boolean(context?.isError);
		item.resultText = textContent(result);
		item.truncated = resultTruncated(result);
		stackBatches.get(item.batchId)!.updatedAt = Date.now();
	}
	const batch = stackBatches.get(item.batchId);
	if (!batch) return makeEmpty();
	const effectiveCwd = context?.cwd ?? cwd;
	const childDisplay = stackChildDisplay(effectiveCwd);
	if (batch.anchorId === id) return renderStackBatch(batch, theme, expanded, effectiveCwd, childDisplay);
	if (childDisplay !== "rows") return makeEmpty();
	const items = batch.items.map((itemId) => stackItems.get(itemId)).filter(Boolean) as StackItem[];
	const index = Math.max(0, items.findIndex((candidate) => candidate.id === id));
	return makeTruncatedLines(renderStackItemText(item, theme, false, effectiveCwd, index === items.length - 1 ? "└" : "├"));
}

function registerStackEvents(pi: ExtensionAPI): void {
	pi.on("agent_start", () => {
		currentStackBatch = null;
	});
	pi.on("tool_execution_start", (event: any) => {
		if (isStackableToolName(event.toolName)) {
			ensureStackItem(event.toolName, String(event.toolCallId), event.args ?? event.input ?? {});
			return;
		}
		currentStackBatch = null;
	});
	pi.on("tool_execution_end", (event: any) => {
		const item = stackItems.get(String(event.toolCallId));
		if (!item) return;
		item.status = event.isError ? "error" : "done";
		item.isError = Boolean(event.isError);
		item.resultText = textContent(event.result);
		item.truncated = resultTruncated(event.result);
		notifyStackBatch(item.batchId);
	});
	pi.on("agent_end", () => {
		currentStackBatch = null;
	});
}

type BuiltInToolName = StackableToolName | "edit" | "write";
type BuiltInToolSet = Partial<Record<BuiltInToolName, any>>;

type BatchToolCall = { args: Record<string, any>; tool: StackableToolName };

interface BatchToolItem {
	args: Record<string, any>;
	details?: unknown;
	index: number;
	isError: boolean;
	resultText: string;
	toolName: StackableToolName;
	truncated: boolean;
}

interface BatchToolDetails {
	items: BatchToolItem[];
	failed: number;
	succeeded: number;
	total: number;
}

const builtInToolCache = new Map<string, BuiltInToolSet>();

function normalizedCwd(cwd?: string): string {
	return resolve(cwd || process.cwd());
}

function createBuiltInToolSet(agent: any, cwd: string): BuiltInToolSet {
	return {
		read: agent.createReadTool?.(cwd),
		bash: agent.createBashTool?.(cwd),
		edit: agent.createEditTool?.(cwd),
		write: agent.createWriteTool?.(cwd),
		grep: agent.createGrepTool?.(cwd),
		find: agent.createFindTool?.(cwd),
		ls: agent.createLsTool?.(cwd),
	};
}

function getBuiltInTool(agent: any, cwd: string, toolName: BuiltInToolName): any {
	const key = normalizedCwd(cwd);
	let tools = builtInToolCache.get(key);
	if (!tools) {
		tools = createBuiltInToolSet(agent, key);
		builtInToolCache.set(key, tools);
	}
	return tools[toolName];
}

function contextCwd(context: any, fallback: string): string {
	return context?.cwd ?? fallback;
}

const ToolBatchParams = {
	type: "object",
	additionalProperties: false,
	properties: {
		calls: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: true,
				description: "One tool call. Prefer { tool, args }, but flat fields such as { tool: 'read', path: 'README.md' } are also accepted.",
				properties: {
					tool: { type: "string", enum: ["read", "grep", "find", "ls", "bash"], description: "Tool to run inside the batch." },
					args: { type: "object", additionalProperties: true, description: "Arguments for the selected tool. Optional; flat sibling fields are folded into args." },
				},
				required: ["tool"],
			},
		},
		concurrency: { type: "number", description: "Maximum calls to run at once. Defaults to all calls, capped by settings." },
	},
	required: ["calls"],
} as const;

function normalizeBatchCalls(value: unknown): BatchToolCall[] {
	if (!Array.isArray(value)) return [];
	const calls: BatchToolCall[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const tool = (raw as any).tool;
		if (!isStackableToolName(tool)) continue;
		const flatArgs: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
			if (key !== "tool" && key !== "args") flatArgs[key] = val;
		}
		const nestedArgs = (raw as any).args && typeof (raw as any).args === "object" && !Array.isArray((raw as any).args) ? (raw as any).args : {};
		calls.push({ args: { ...flatArgs, ...nestedArgs }, tool });
	}
	return calls;
}

async function mapBatchWithConcurrency<TIn, TOut>(items: TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]> {
	const results = new Array<TOut>(items.length);
	let next = 0;
	const workers = new Array(Math.max(1, Math.min(concurrency, items.length || 1))).fill(null).map(async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

function batchStackItem(item: BatchToolItem): StackItem {
	return {
		args: item.args,
		batchId: "tool-batch",
		id: `tool-batch:${item.index}`,
		isError: item.isError,
		resultText: item.resultText,
		status: item.isError ? "error" : "done",
		toolName: item.toolName,
		truncated: item.truncated,
	};
}

function renderToolBatchText(items: BatchToolItem[], theme: any, expanded: boolean, cwd?: string): string {
	const failed = items.filter((item) => item.isError).length;
	const succeeded = items.length - failed;
	const header =
		stackPrefix(theme) +
		toolLabel(theme, `Batch ran ${plural(items.length, "tool")}`) +
		theme.fg(failed > 0 ? "warning" : "success", ` · ${succeeded}/${items.length} succeeded`) +
		(expanded ? "" : theme.fg("dim", " · Ctrl+O to inspect"));
	const lines = [header];
	items.forEach((item, index) => {
		const stackItem = batchStackItem(item);
		lines.push(renderStackItemText(stackItem, theme, expanded, cwd, index === items.length - 1 ? "└" : "├"));
	});
	return lines.join("\n");
}

function toolBatchOutput(items: BatchToolItem[]): string {
	const failed = items.filter((item) => item.isError).length;
	const lines = [`Batch: ${items.length - failed}/${items.length} succeeded`];
	for (const item of items) {
		const label = `${item.index + 1}. ${item.toolName}`;
		lines.push("", `## ${label}`, item.isError ? "Status: failed" : "Status: completed", item.resultText || "(no output)");
	}
	return lines.join("\n");
}

function renderToolBatchCallText(args: any, theme: any, cwd?: string): string {
	const calls = normalizeBatchCalls(args?.calls);
	const lines = [stackPrefix(theme) + toolLabel(theme, `${calls.length || 0} batched tool${calls.length === 1 ? "" : "s"} launching`)];
	calls.slice(0, 12).forEach((call, index) => {
		const item: StackItem = { args: call.args, batchId: "call", id: String(index), isError: false, resultText: "", status: "running", toolName: call.tool, truncated: false };
		lines.push(`${treeConnector(theme, index === calls.length - 1 ? "└" : "├")}${stackItemCallText(item, theme, cwd)}`);
	});
	if (calls.length > 12) lines.push(`${treeConnector(theme, "└")}${theme.fg("muted", `… +${calls.length - 12} more`)}`);
	return lines.join("\n");
}

function registerToolBatch(pi: ExtensionAPI, agent: any, cwd: string): void {
	pi.registerTool({
		renderShell: "self",
		name: "tool_batch",
		label: "Tool Batch",
		description:
			"Run multiple independent read/grep/find/ls/bash calls as one composite tool with a single stacked renderer. Prefer this over separate parallel read/search/list/diagnostic bash calls. Use bash only for diagnostic commands whose side effects and ordering do not matter.",
		promptSnippet: "Batch 2+ independent read/search/list/diagnostic bash calls into one compact result.",
		promptGuidelines: [
			"Prefer tool_batch instead of separate parallel read, grep, find, ls, or diagnostic bash calls whenever the calls are independent.",
			"Use individual read/grep/find/ls/bash calls when there is only one call, when calls depend on previous results, when bash mutates state, when streaming/live output matters, or when the user explicitly wants separate tool entries.",
			"Do not use tool_batch for edit/write or for bash commands that mutate files, depend on ordering, need streaming output, or should be inspected as separate commands.",
		],
		parameters: ToolBatchParams as never,
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, _onUpdate: unknown, context: any) {
			const effectiveCwd = contextCwd(context, cwd);
			const calls = normalizeBatchCalls(params?.calls);
			const maxCalls = Math.max(1, Math.floor(settingNumber("batchMaxCalls", 8, effectiveCwd)));
			if (calls.length === 0) return { content: [{ type: "text", text: "No valid calls provided." }], details: { failed: 0, items: [], succeeded: 0, total: 0 } };
			if (calls.length > maxCalls) {
				return {
					content: [{ type: "text", text: `Too many calls (${calls.length}). Max is ${maxCalls}.` }],
					details: { failed: calls.length, items: [], succeeded: 0, total: calls.length },
					isError: true,
				};
			}
			const concurrency = Math.max(1, Math.min(calls.length, Math.floor(Number(params?.concurrency) || calls.length), maxCalls));
			const items = await mapBatchWithConcurrency(calls, concurrency, async (call, index): Promise<BatchToolItem> => {
				try {
					const original = getBuiltInTool(agent, effectiveCwd, call.tool);
					if (!original?.execute) throw new Error(`Built-in tool unavailable: ${call.tool}`);
					const result = await original.execute(`${toolCallId}:${index}`, call.args, signal, undefined);
					return {
						args: call.args,
						details: result?.details,
						index,
						isError: Boolean(result?.isError),
						resultText: textContent(result),
						toolName: call.tool,
						truncated: resultTruncated(result),
					};
				} catch (error) {
					return {
						args: call.args,
						index,
						isError: true,
						resultText: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
						toolName: call.tool,
						truncated: false,
					};
				}
			});
			const failed = items.filter((item) => item.isError).length;
			const details: BatchToolDetails = { failed, items, succeeded: items.length - failed, total: items.length };
			return { content: [{ type: "text", text: toolBatchOutput(items) }], details, isError: failed > 0 };
		},
		renderCall() {
			return makeEmpty();
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
			if (isPartial) return makeTruncatedLines(renderToolBatchCallText(context?.args, theme, context?.cwd ?? cwd));
			const details = result.details as BatchToolDetails | undefined;
			if (!details?.items) return makeTruncatedLines(textContent(result) || "(no output)");
			return makeTruncatedLines(renderToolBatchText(details.items, theme, expanded, context?.cwd ?? cwd));
		},
	});
}

function registerRead(pi: ExtensionAPI, agent: any, cwd: string): void {
	const original = getBuiltInTool(agent, cwd, "read");
	if (!original) return;
	pi.registerTool({
		renderShell: "self",
		name: "read",
		label: "read",
		description: original.description,
		parameters: original.parameters,
		async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, context: any) {
			return getBuiltInTool(agent, contextCwd(context, cwd), "read").execute(id, params, signal, onUpdate);
		},
		renderCall() {
			return makeEmpty();
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
			const stacked = stackToolCalls(context?.cwd ?? cwd);
			if (stacked) return renderStackedToolResult("read", result, isPartial, expanded, theme, context, cwd);
			const call = readCallText(context?.args ?? {}, theme);
			if (isPartial) return makeTruncatedLines(`${blinkingPrefix(theme, context)}${call}${theme.fg("dim", " · ")}${theme.fg("warning", "reading…")}`);
			clearBlink(context);
			const content = textContent(result);
			const count = lineCount(content);
			let summary = theme.fg("success", `${count} line${count === 1 ? "" : "s"}`);
			if (resultTruncated(result)) summary += theme.fg("warning", " · truncated");
			let text = `${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${summary}`;
			if (expanded && content) {
				const limit = Math.max(1, Math.floor(settingNumber("readPreviewLines", 80, context?.cwd)));
				text += `\n${preview(content, limit, "head", context?.cwd)
					.split(/\r?\n/)
					.map((line) => `${treeConnector(theme, "│")}${theme.fg("dim", line)}`)
					.join("\n")}`;
				if (count > limit) text += `\n${treeConnector(theme, "│")}${theme.fg("muted", `… ${count - limit} more line(s)`)}`;
			}
			return makeTruncatedLines(text);
		},
	});
}

function registerBash(pi: ExtensionAPI, agent: any, cwd: string): void {
	const original = getBuiltInTool(agent, cwd, "bash");
	if (!original) return;
	pi.registerTool({
		renderShell: "self",
		name: "bash",
		label: "bash",
		description: original.description,
		parameters: original.parameters,
		async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, context: any) {
			return getBuiltInTool(agent, contextCwd(context, cwd), "bash").execute(id, params, signal, onUpdate);
		},
		renderCall() {
			return makeEmpty();
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
			const stacked = stackToolCalls(context?.cwd ?? cwd);
			if (stacked) return renderStackedToolResult("bash", result, isPartial, expanded, theme, context, cwd);
			const call = bashCallText(context?.args ?? {}, theme, context?.cwd ?? cwd);
			const output = textContent(result);
			if (isPartial) {
				const count = output.trim() ? output.split(/\r?\n/).filter((line) => line.trim().length > 0).length : 0;
				const lineText = count === 0 ? "starting" : `${count} line${count === 1 ? "" : "s"}`;
				return makeTruncatedLines(`${blinkingPrefix(theme, context)}${call}${theme.fg("dim", " · ")}${theme.fg("warning", `running… ${lineText}`)}`);
			}
			clearBlink(context);
			const exit = commandExit(output);
			const count = lineCount(output);
			const exitLabel = exit === null ? "exit 0" : `exit ${exit}`;
			let summary = exit !== null && exit !== 0 ? theme.fg("error", exitLabel) : theme.fg("success", exitLabel);
			summary += theme.fg("dim", ` · ${count} line${count === 1 ? "" : "s"}`);
			if (resultTruncated(result)) summary += theme.fg("warning", " · truncated");
			let text = `${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${summary}`;
			if (expanded && output) {
				const limit = Math.max(1, Math.floor(settingNumber("bashPreviewLines", 80, context?.cwd)));
				text += `\n${preview(output, limit, "tail", context?.cwd)
					.split(/\r?\n/)
					.map((line) => `${treeConnector(theme, "│")}${theme.fg("dim", line)}`)
					.join("\n")}`;
				if (count > limit) text += `\n${treeConnector(theme, "│")}${theme.fg("muted", `… ${count - limit} older line(s)`)}`;
			}
			return makeTruncatedLines(text);
		},
	});
}

function registerEdit(pi: ExtensionAPI, agent: any, cwd: string): void {
	const original = getBuiltInTool(agent, cwd, "edit");
	if (!original) return;
	pi.registerTool({
		renderShell: "self",
		name: "edit",
		label: "edit",
		description: original.description,
		parameters: original.parameters,
		async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, context: any) {
			const effectiveCwd = contextCwd(context, cwd);
			const targetPath = params?.path ?? params?.file_path;
			const before = readTextForDiff(targetPath, effectiveCwd);
			const result = await getBuiltInTool(agent, effectiveCwd, "edit").execute(id, params, signal, onUpdate);
			const after = result?.isError ? before : readTextForDiff(targetPath, effectiveCwd);
			return attachDiffDetails(result, before, after);
		},
		renderCall() {
			return makeEmpty();
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
			const args = context?.args ?? {};
			const targetPath = args.path ?? args.file_path ?? "";
			const call = `${toolLabel(theme, "Edit ")}${theme.fg("accent", targetPath)}`;
			if (isPartial) return makeTruncatedLines(`${blinkingPrefix(theme, context)}${call}${theme.fg("dim", " · ")}${theme.fg("warning", "editing…")}`);
			clearBlink(context);
			const structured = result?.details?.vstackDiff as StructuredDiff | undefined;
			if (context?.isError || result?.isError) {
				const errorText = textContent(result).split(/\r?\n/)[0] || "edit failed";
				return makeTruncatedLines(`${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${theme.fg("error", errorText)}`);
			}
			const summary = structured ? diffSummary(structured, theme) : theme.fg("success", "applied");
			let text = `${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${summary}`;
			if (structured) text += `\n${renderStructuredDiff(structured, theme, expanded, context?.cwd ?? cwd)}`;
			return makeTruncatedLines(text);
		},
	});
}

function registerWrite(pi: ExtensionAPI, agent: any, cwd: string): void {
	const original = getBuiltInTool(agent, cwd, "write");
	if (!original) return;
	pi.registerTool({
		renderShell: "self",
		name: "write",
		label: "write",
		description: original.description,
		parameters: original.parameters,
		async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, context: any) {
			const effectiveCwd = contextCwd(context, cwd);
			const targetPath = params?.path ?? params?.file_path;
			const before = readTextForDiff(targetPath, effectiveCwd);
			const result = await getBuiltInTool(agent, effectiveCwd, "write").execute(id, params, signal, onUpdate);
			const after = result?.isError ? before : typeof params?.content === "string" ? params.content : readTextForDiff(targetPath, effectiveCwd);
			return attachDiffDetails(result, before, after);
		},
		renderCall() {
			return makeEmpty();
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
			const args = context?.args ?? {};
			const targetPath = args.path ?? args.file_path ?? "";
			const lineTotal = lineCount(args.content ?? "");
			const label = result?.details?.vstackDiffWasNewFile ? "Create " : "Write ";
			const call = `${toolLabel(theme, label)}${theme.fg("accent", targetPath)} ${theme.fg("dim", `· ${lineTotal} lines`)}`;
			if (isPartial) return makeTruncatedLines(`${blinkingPrefix(theme, context)}${call}${theme.fg("dim", " · ")}${theme.fg("warning", "writing…")}`);
			clearBlink(context);
			const structured = result?.details?.vstackDiff as StructuredDiff | undefined;
			if (context?.isError || result?.isError) {
				const errorText = textContent(result).split(/\r?\n/)[0] || "write failed";
				return makeTruncatedLines(`${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${theme.fg("error", errorText)}`);
			}
			const summary = structured ? diffSummary(structured, theme) : theme.fg("success", "written");
			let text = `${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${summary}`;
			if (structured) text += `\n${renderStructuredDiff(structured, theme, expanded, context?.cwd ?? cwd)}`;
			return makeTruncatedLines(text);
		},
	});
}

function registerReadOnly(pi: ExtensionAPI, agent: any, cwd: string, toolName: "grep" | "find" | "ls"): void {
	const original = getBuiltInTool(agent, cwd, toolName);
	if (!original) return;
	pi.registerTool({
		renderShell: "self",
		name: toolName,
		label: toolName,
		description: original.description,
		parameters: original.parameters,
		async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, context: any) {
			return getBuiltInTool(agent, contextCwd(context, cwd), toolName).execute(id, params, signal, onUpdate);
		},
		renderCall() {
			return makeEmpty();
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
			const stacked = stackToolCalls(context?.cwd ?? cwd);
			if (stacked) return renderStackedToolResult(toolName, result, isPartial, expanded, theme, context, cwd);
			const call = readOnlyCallText(toolName, context?.args ?? {}, theme, context?.cwd ?? cwd);
			if (isPartial) return makeTruncatedLines(`${blinkingPrefix(theme, context)}${call}${theme.fg("dim", " · ")}${theme.fg("warning", `${toolName}…`)}`);
			clearBlink(context);
			const output = textContent(result);
			const count = output.trim() ? lineCount(output) : 0;
			const noun = toolName === "grep" ? "match" : toolName === "ls" ? "entr" : "file";
			const label = toolName === "ls" ? `${count} ${noun}${count === 1 ? "y" : "ies"}` : `${count} ${noun}${count === 1 ? "" : "s"}`;
			let summary = count === 0 ? theme.fg("muted", toolName === "grep" ? "no matches" : toolName === "ls" ? "empty" : "no files") : theme.fg("success", label);
			if (resultTruncated(result)) summary += theme.fg("warning", " · truncated");
			let text = `${stackPrefix(theme)}${call}${theme.fg("dim", " · ")}${summary}`;
			if (expanded && output) {
				if (toolName === "find" || toolName === "ls") {
					text += `\n${renderPathListPreview(output, toolName, theme, expanded, context?.cwd)}`;
				} else {
					const limit = Math.max(1, Math.floor(settingNumber("searchPreviewLines", 80, context?.cwd)));
					text += `\n${preview(output, limit, "head", context?.cwd)
						.split(/\r?\n/)
						.map((line) => `${treeConnector(theme, "│")}${theme.fg("dim", line)}`)
						.join("\n")}`;
					if (count > limit) text += `\n${treeConnector(theme, "│")}${theme.fg("muted", `… ${count - limit} more result line(s)`)}`;
				}
			}
			return makeTruncatedLines(text);
		},
	});
}

export default async function toolRenderer(pi: ExtensionAPI): Promise<void> {
	const guard = pi as unknown as Record<PropertyKey, unknown>;
	if (guard[INSTALL_SYMBOL]) return;
	guard[INSTALL_SYMBOL] = true;
	if (!settingBoolean("enabled", true)) return;

	registerStackEvents(pi);

	const agent = await import("@mariozechner/pi-coding-agent");
	installUserMessageRenderer(pi, agent.UserMessageComponent);
	const cwd = process.cwd();
	registerRead(pi, agent, cwd);
	registerBash(pi, agent, cwd);
	if (settingBoolean("renderMutationTools", false, cwd)) {
		registerEdit(pi, agent, cwd);
		registerWrite(pi, agent, cwd);
	}
	registerReadOnly(pi, agent, cwd, "grep");
	registerReadOnly(pi, agent, cwd, "find");
	registerReadOnly(pi, agent, cwd, "ls");
	if (settingBoolean("registerBatchTool", true, cwd)) registerToolBatch(pi, agent, cwd);
}
