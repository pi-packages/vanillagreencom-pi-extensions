import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { actionSummary, parseApplyPatch, type ParsedPatch, type PatchAction, type PatchHunk } from "./parser.js";

export interface ApplyPatchOptions {
	cwd: string;
	allowAbsolutePaths?: boolean;
}

export interface AppliedPatchFile {
	kind: PatchAction["kind"];
	path: string;
	absolutePath: string;
	moveTo?: string;
	absoluteMoveTo?: string;
}

export interface ApplyPatchResult {
	files: AppliedPatchFile[];
	summary: string;
}

function cleanPatchPath(pathValue: string): string {
	let cleaned = pathValue.trim();
	if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) cleaned = cleaned.slice(1, -1);
	if (cleaned.startsWith("@")) cleaned = cleaned.slice(1);
	return cleaned;
}

export function resolvePatchPath(pathValue: string, options: ApplyPatchOptions): string {
	const cleaned = cleanPatchPath(pathValue);
	const absolute = isAbsolute(cleaned) ? resolve(cleaned) : resolve(options.cwd, cleaned);
	const cwd = resolve(options.cwd);
	const rel = relative(cwd, absolute);
	const insideCwd = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	if (!insideCwd && !options.allowAbsolutePaths) throw new Error(`Patch path escapes cwd: ${pathValue}`);
	return absolute;
}

function stripMarker(line: string): string {
	if (line === "\\ No newline at end of file") return "";
	const marker = line[0];
	return marker === "+" || marker === "-" || marker === " " ? line.slice(1) : line;
}

function hunkOldText(hunk: PatchHunk): string {
	return hunk.lines.filter((line) => line.startsWith("-") || line.startsWith(" ")).map(stripMarker).join("\n");
}

function hunkNewText(hunk: PatchHunk): string {
	return hunk.lines.filter((line) => line.startsWith("+") || line.startsWith(" ")).map(stripMarker).join("\n");
}

function addText(action: PatchAction): string {
	return action.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.startsWith("+")).map(stripMarker)).join("\n");
}

async function readUtf8(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new Error(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function replaceOnce(content: string, oldText: string, newText: string, path: string): string {
	if (oldText.length === 0) return `${content}${newText}`;
	const index = content.indexOf(oldText);
	if (index >= 0) return `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`;
	if (!oldText.endsWith("\n")) {
		const withNewline = `${oldText}\n`;
		const newlineIndex = content.indexOf(withNewline);
		if (newlineIndex >= 0) return `${content.slice(0, newlineIndex)}${newText}${content.slice(newlineIndex + withNewline.length)}`;
	}
	throw new Error(`Patch context not found in ${path}`);
}

async function applyAdd(action: PatchAction, options: ApplyPatchOptions): Promise<AppliedPatchFile> {
	const absolutePath = resolvePatchPath(action.path, options);
	const content = addText(action);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, content, "utf8");
	return { absolutePath, kind: action.kind, path: action.path };
}

async function applyUpdate(action: PatchAction, options: ApplyPatchOptions): Promise<AppliedPatchFile> {
	const absolutePath = resolvePatchPath(action.path, options);
	let content = await readUtf8(absolutePath);
	for (const hunk of action.hunks) content = replaceOnce(content, hunkOldText(hunk), hunkNewText(hunk), action.path);
	await writeFile(absolutePath, content, "utf8");
	let absoluteMoveTo: string | undefined;
	if (action.moveTo) {
		absoluteMoveTo = resolvePatchPath(action.moveTo, options);
		await mkdir(dirname(absoluteMoveTo), { recursive: true });
		await rename(absolutePath, absoluteMoveTo);
	}
	return { absoluteMoveTo, absolutePath, kind: action.kind, moveTo: action.moveTo, path: action.path };
}

async function applyDelete(action: PatchAction, options: ApplyPatchOptions): Promise<AppliedPatchFile> {
	const absolutePath = resolvePatchPath(action.path, options);
	await rm(absolutePath, { force: false });
	return { absolutePath, kind: action.kind, path: action.path };
}

export async function applyParsedPatch(parsed: ParsedPatch, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	const files: AppliedPatchFile[] = [];
	try {
		for (const action of parsed.actions) {
			if (action.kind === "add") files.push(await applyAdd(action, options));
			else if (action.kind === "update") files.push(await applyUpdate(action, options));
			else files.push(await applyDelete(action, options));
		}
	} catch (error) {
		const applied = files.map((file) => `${file.kind} ${file.path}`).join(", ") || "none";
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${message}\nPartial apply status: completed actions before failure: ${applied}. Review the working tree before retrying.`);
	}
	return {
		files,
		summary: `Applied patch: ${parsed.actions.map(actionSummary).join(", ")}`,
	};
}

export async function applyPatch(input: string, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	return applyParsedPatch(parseApplyPatch(input), options);
}
