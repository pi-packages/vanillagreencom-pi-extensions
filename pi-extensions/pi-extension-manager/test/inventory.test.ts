import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { toggleItem } from "../extensions/manager/actions.ts";
import { buildInventory } from "../extensions/manager/inventory.ts";

const rootTmp = join(process.cwd(), "tmp", "pi-extension-manager-inventory-tests");
const originalEnv = {
	HOME: process.env.HOME,
	NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX,
	npm_config_prefix: process.env.npm_config_prefix,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
};

function resetTmp(): void {
	rmSync(rootTmp, { force: true, recursive: true });
	mkdirSync(rootTmp, { recursive: true });
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writePackage(dir: string, name: string, displayName: string, settingsKey: string): void {
	mkdirSync(join(dir, "extensions"), { recursive: true });
	writeFileSync(join(dir, "extensions", "index.ts"), "export default function () {}\n", "utf8");
	writeJson(join(dir, "package.json"), {
		name,
		version: "1.2.3",
		description: `${displayName} package`,
		pi: { extensions: ["./extensions/index.ts"] },
		vstack: {
			extensionManager: {
				displayName,
				settings: [
					{ key: settingsKey, label: settingsKey, type: "boolean", default: true },
				],
			},
		},
	});
}

function inventory(cwd: string) {
	return buildInventory({} as never, { cwd } as never);
}

beforeEach(() => {
	resetTmp();
	process.env.HOME = join(rootTmp, "home");
	process.env.NPM_CONFIG_PREFIX = join(rootTmp, "npm-prefix");
	process.env.npm_config_prefix = process.env.NPM_CONFIG_PREFIX;
	process.env.PI_CODING_AGENT_DIR = join(rootTmp, "home", ".pi", "agent");
});

afterEach(() => {
	if (originalEnv.HOME === undefined) delete process.env.HOME;
	else process.env.HOME = originalEnv.HOME;
	if (originalEnv.NPM_CONFIG_PREFIX === undefined) delete process.env.NPM_CONFIG_PREFIX;
	else process.env.NPM_CONFIG_PREFIX = originalEnv.NPM_CONFIG_PREFIX;
	if (originalEnv.npm_config_prefix === undefined) delete process.env.npm_config_prefix;
	else process.env.npm_config_prefix = originalEnv.npm_config_prefix;
	if (originalEnv.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalEnv.PI_CODING_AGENT_DIR;
	rmSync(rootTmp, { force: true, recursive: true });
});

test("reads settings schemas from globally installed npm packages", () => {
	const project = join(rootTmp, "project");
	const userPi = process.env.PI_CODING_AGENT_DIR!;
	const npmPackageDir = join(process.env.NPM_CONFIG_PREFIX!, "lib", "node_modules", "@scope", "user-settings");
	mkdirSync(join(project, ".pi"), { recursive: true });
	writeJson(join(userPi, "settings.json"), { packages: ["npm:@scope/user-settings"] });
	writePackage(npmPackageDir, "@scope/user-settings", "User Settings", "enabled");

	const inv = inventory(project);
	const item = inv.packages.find((pkg) => pkg.packageName === "@scope/user-settings");
	expect(item?.scope).toBe("user");
	expect(item?.state).toBe("active");
	expect(item?.displayName).toBe("User Settings");
	expect(item?.settingsSchema?.map((schema) => schema.key)).toEqual(["enabled"]);
	expect(item?.packageDir).toBe(npmPackageDir);
	expect(inv.items.some((entry) => entry.kind === "extension module" && entry.sourcePath === join(npmPackageDir, "extensions", "index.ts"))).toBe(true);
});

test("project npm package settings override same global npm package", () => {
	const project = join(rootTmp, "project");
	const projectPi = join(project, ".pi");
	const userPi = process.env.PI_CODING_AGENT_DIR!;
	const userPackageDir = join(process.env.NPM_CONFIG_PREFIX!, "lib", "node_modules", "@scope", "dupe-settings");
	const projectPackageDir = join(projectPi, "npm", "node_modules", "@scope", "dupe-settings");
	writeJson(join(userPi, "settings.json"), { packages: ["npm:@scope/dupe-settings"] });
	writeJson(join(projectPi, "settings.json"), { packages: ["npm:@scope/dupe-settings"] });
	writePackage(userPackageDir, "@scope/dupe-settings", "User Copy", "userFlag");
	writePackage(projectPackageDir, "@scope/dupe-settings", "Project Copy", "projectFlag");

	const inv = inventory(project);
	const copies = inv.packages.filter((pkg) => pkg.packageName === "@scope/dupe-settings");
	expect(copies).toHaveLength(2);
	expect(copies.find((pkg) => pkg.scope === "project")?.state).toBe("active");
	expect(copies.find((pkg) => pkg.scope === "project")?.displayName).toBe("Project Copy");
	expect(copies.find((pkg) => pkg.scope === "project")?.settingsSchema?.map((schema) => schema.key)).toEqual(["projectFlag"]);
	expect(copies.find((pkg) => pkg.scope === "user")?.state).toBe("shadowed");
});

test("reads settings schemas from project git package clones", () => {
	const project = join(rootTmp, "project");
	const projectPi = join(project, ".pi");
	const gitPackageDir = join(projectPi, "git", "github.com", "acme", "pi-package");
	writeJson(join(projectPi, "settings.json"), { packages: ["git:github.com/acme/pi-package@v1.0.0"] });
	writePackage(gitPackageDir, "acme-pi-package", "Git Package", "gitFlag");

	const inv = inventory(project);
	const item = inv.packages.find((pkg) => pkg.packageName === "acme-pi-package");
	expect(item?.scope).toBe("project");
	expect(item?.state).toBe("active");
	expect(item?.settingsSchema?.map((schema) => schema.key)).toEqual(["gitFlag"]);
	expect(item?.packageDir).toBe(gitPackageDir);
});

test("toggles project npm packages by original settings source", () => {
	const project = join(rootTmp, "project");
	const projectPi = join(project, ".pi");
	const projectPackageDir = join(projectPi, "npm", "node_modules", "@scope", "toggle-settings");
	const settingsPath = join(projectPi, "settings.json");
	writeJson(settingsPath, { packages: ["npm:@scope/toggle-settings"] });
	writePackage(projectPackageDir, "@scope/toggle-settings", "Toggle Settings", "enabled");

	const inv = inventory(project);
	const item = inv.packages.find((pkg) => pkg.packageName === "@scope/toggle-settings");
	expect(item?.sourcePath).toBe(projectPackageDir);
	toggleItem({} as never, { cwd: project, ui: { notify() {} } } as never, inv, item!);

	const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
	expect(saved.packages).toEqual([{ source: "npm:@scope/toggle-settings", extensions: [] }]);
});
