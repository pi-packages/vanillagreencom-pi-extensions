import { stat, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type ImageDetail = "auto" | "low" | "high" | "original";

export interface ViewImageInput {
	path: string;
	detail?: ImageDetail;
}

export interface ValidatedImage {
	absolutePath: string;
	displayPath: string;
	mimeType: string;
	sizeBytes: number;
	detail: ImageDetail;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".svg": "image/svg+xml",
};

export function normalizeImagePath(pathValue: string, cwd: string): { absolutePath: string; displayPath: string } {
	let cleaned = pathValue.trim();
	if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) cleaned = cleaned.slice(1, -1);
	if (cleaned.startsWith("@")) cleaned = cleaned.slice(1);
	return { absolutePath: resolve(cwd, cleaned), displayPath: cleaned };
}

export function mimeTypeForImagePath(path: string): string | undefined {
	return IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
}

export async function validateImagePath(input: ViewImageInput, cwd: string): Promise<ValidatedImage> {
	if (!input || typeof input.path !== "string" || input.path.trim().length === 0) throw new Error("view_image requires a non-empty path.");
	const detail = input.detail ?? "auto";
	if (!["auto", "low", "high", "original"].includes(detail)) throw new Error(`Unsupported image detail: ${String(input.detail)}`);
	const normalized = normalizeImagePath(input.path, cwd);
	let fileStat;
	try {
		fileStat = await stat(normalized.absolutePath);
	} catch {
		throw new Error(`Image not found: ${normalized.displayPath}`);
	}
	if (fileStat.isDirectory()) throw new Error(`view_image expected a file but got a directory: ${normalized.displayPath}`);
	if (!fileStat.isFile()) throw new Error(`view_image expected a regular image file: ${normalized.displayPath}`);
	const mimeType = mimeTypeForImagePath(normalized.absolutePath);
	if (!mimeType) throw new Error(`Unsupported image file type for view_image: ${normalized.displayPath}`);
	return { ...normalized, detail, mimeType, sizeBytes: fileStat.size };
}

export async function viewImage(input: ViewImageInput, cwd: string) {
	const image = await validateImagePath(input, cwd);
	const data = await readFile(image.absolutePath, "base64");
	return {
		content: [{ type: "image", data, mimeType: image.mimeType, detail: image.detail }],
		details: image,
	};
}

export const viewImageToolSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: { type: "string", description: "Path to the local image file. Relative paths resolve against ctx.cwd; a leading @ is accepted and stripped." },
		detail: { type: "string", enum: ["auto", "low", "high", "original"], description: "Image detail hint. Defaults to auto." },
	},
	required: ["path"],
};
