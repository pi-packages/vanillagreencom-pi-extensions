#!/usr/bin/env bun
// CLI parity port of skills/flightdeck/scripts/parallel-groups.
// Reads/writes a single JSON cache file at $ORCH_CACHE_DIR/parallel-groups.json
// with flock(1)-guarded mutations. Filter staleness against issues.json.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDotEnvIntoProcess, resolveProjectRoot } from "../shared/project.ts";
import { lockedAtomicWrite } from "../state/locking.ts";
import { STATE_ONLY_REQUIRED, preflightDeps } from "../shared/preflight.ts";

preflightDeps(STATE_ONLY_REQUIRED);

function die(msg: string, code = 1): never {
	process.stderr.write(`${msg}\n`);
	process.exit(code);
}

const root = resolveProjectRoot();
loadDotEnvIntoProcess(root);
const cacheDir = process.env.ORCH_CACHE_DIR && process.env.ORCH_CACHE_DIR.trim()
	? resolve(process.env.ORCH_CACHE_DIR.trim())
	: join(root, ".cache/orchestration");
const groupsFile = join(cacheDir, "parallel-groups.json");
const issuesFile = join(cacheDir, "issues.json");
const lockFile = `${cacheDir}/parallel-groups.json.lock`;

function ensureFile(): void {
	mkdirSync(cacheDir, { recursive: true });
	if (!existsSync(groupsFile)) writeFileSync(groupsFile, '{"groups":[]}');
}

function runJq(filter: string, input: string, raw = false): string {
	const args = raw ? ["-r", filter] : ["-c", filter];
	const r = spawnSync("jq", args, { encoding: "utf8", input });
	if (r.status !== 0) {
		process.stderr.write(r.stderr ?? "");
		process.exit(r.status ?? 1);
	}
	return r.stdout ?? "";
}

function runJqArgs(filter: string, jsonArgs: Record<string, string>, input: string, raw = false): string {
	const args: string[] = raw ? ["-r"] : ["-c"];
	for (const [k, v] of Object.entries(jsonArgs)) {
		args.push("--argjson", k, v);
	}
	args.push(filter);
	const r = spawnSync("jq", args, { encoding: "utf8", input });
	if (r.status !== 0) {
		process.stderr.write(r.stderr ?? "");
		process.exit(r.status ?? 1);
	}
	return r.stdout ?? "";
}

function filterStale(groupsJson: string, verdictFilter: "safe" | "all"): string {
	if (!existsSync(issuesFile)) return "[]\n";
	const issuesText = readFileSync(issuesFile, "utf8");
	const filter = `
		($issues[0] | if type == "array" then . else [.] end |
		  [.[] | {(.identifier): .updatedAt}] | add // {}) as $current |
		[.groups[] |
		  select(if $vf == "all" then true else .verdict == "safe" end) |
		  select(
		    ([.issue_fingerprints | to_entries[] |
		      ($current[.key] // null) as $cur |
		      if $cur == null then false
		      elif $cur != .value then false
		      else true end
		    ] | all)
		    and
		    (if .children_fingerprints then
		      [.children_fingerprints | to_entries[] |
		        ($current[.key] // null) as $cur |
		        if $cur == null then false
		        elif $cur != .value then false
		        else true end
		      ] | all
		    else true end)
		  )
		]
	`;
	// jq needs $issues as a slurpfile and $vf as a plain arg.
	const r = spawnSync(
		"jq",
		["-c", "--arg", "vf", verdictFilter, "--slurpfile", "issues", issuesFile, filter],
		{ encoding: "utf8", input: groupsJson },
	);
	if (r.status !== 0) {
		process.stderr.write(r.stderr ?? "");
		process.exit(r.status ?? 1);
	}
	return r.stdout ?? "[]";
}

function nextGroupId(data: string): number {
	const out = runJq("[.groups[].group_id] | (max // 0) + 1", data);
	return Number.parseInt(out.trim() || "1", 10);
}

function cmdRead(args: string[]): void {
	const verdict: "safe" | "all" = args[0] === "--all" ? "all" : "safe";
	ensureFile();
	const data = readFileSync(groupsFile, "utf8");
	process.stdout.write(filterStale(data, verdict));
}

function cmdWrite(input: string): void {
	if (!input) die("'JSON argument required'");
	ensureFile();
	// Validate input parses as JSON before grabbing the lock.
	try { JSON.parse(input); } catch { die("Error: invalid JSON input"); }
	// Read-modify-write under flock: compute next id from on-disk state,
	// merge the new group with that id, and append. The whole read +
	// next-id + merge + write runs inside the bash child holding flock,
	// so two concurrent writers don't both pick the same group_id.
	const script = `
		set -e
		file="$1"; tmp="$2"; new_group="$3"
		next_id=$(jq '[.groups[].group_id] | (max // 0) + 1' "$file")
		jq --argjson g "$new_group" --argjson id "$next_id" \
			'.groups += [($g + {group_id: $id})]' "$file" > "$tmp"
		mv "$tmp" "$file"
		echo "$next_id"
	`;
	const tmp = `${groupsFile}.tmp.${process.pid}`;
	const r = spawnSync("flock", ["-x", lockFile, "bash", "-c", script, "_", groupsFile, tmp, input], { encoding: "utf8" });
	if (r.status !== 0) {
		process.stderr.write(r.stderr ?? "");
		process.exit(r.status ?? 1);
	}
	process.stdout.write(r.stdout ?? "");
}

function cmdClear(args: string[]): void {
	ensureFile();
	let groupId = "";
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === "--group") { groupId = args[++i] ?? ""; }
	}
	if (groupId) {
		// Validate. Bash original passed via `--argjson gid "$group_id"`
		// which rejects non-numeric input; the previous TS regex strip
		// transformed `1abc2` into `12` and silently deleted the wrong
		// group. Reject up front — exit 2 to match bash's usage-error
		// convention.
		if (!/^-?\d+$/.test(groupId)) die(`Error: --group requires an integer, got '${groupId}'`, 2);
		// Now use --argjson so the filter sees a number, not a string,
		// matching the bash flow.
		const tmp = `${groupsFile}.tmp.${process.pid}`;
		const script = `
			set -e
			file="$1"; tmp="$2"; gid="$3"
			jq --argjson gid "$gid" '.groups |= map(select(.group_id != $gid))' "$file" > "$tmp"
			mv "$tmp" "$file"
		`;
		const r = spawnSync("flock", ["-x", lockFile, "bash", "-c", script, "_", groupsFile, tmp, groupId], { encoding: "utf8" });
		if (r.status !== 0) {
			process.stderr.write(r.stderr ?? "");
			process.exit(r.status ?? 1);
		}
	} else {
		const r = lockedAtomicWrite(lockFile, groupsFile, '{"groups":[]}');
		if (r.status !== 0) {
			process.stderr.write(r.stderr || "");
			process.exit(r.status ?? 1);
		}
	}
}

function cmdLookup(issue: string): void {
	if (!issue) die("'Issue ID required'");
	ensureFile();
	const data = readFileSync(groupsFile, "utf8");
	const fresh = filterStale(data, "safe");
	// Use --arg to bind the issue id so a malicious/weird id can't escape the filter.
	const r = spawnSync(
		"jq",
		["-r", "--arg", "issue", issue, "[.[] | select(.issues[] == $issue) | .group_id] | first // empty"],
		{ encoding: "utf8", input: fresh },
	);
	if (r.status !== 0) {
		process.stderr.write(r.stderr ?? "");
		process.exit(r.status ?? 1);
	}
	process.stdout.write(r.stdout ?? "");
}

function cmdNeedsRefresh(candidates: string[]): void {
	if (candidates.length < 2) {
		process.stdout.write("skip: <2 issues\n");
		process.exit(1);
	}
	ensureFile();
	const data = readFileSync(groupsFile, "utf8");
	const candsJson = JSON.stringify(candidates);
	const allCovered = runJqArgs(
		`([$data.groups[]? | (.issues[]?, (.children_fingerprints // {} | keys[]))] | unique) as $covered |
		 [$cands[] | select(. as $c | $covered | index($c) | not)] | length == 0`,
		{ cands: candsJson, data },
		"null",
		true,
	).trim();
	if (allCovered === "true") {
		process.stdout.write(`fresh: all ${candidates.length} covered\n`);
		process.exit(1);
	}
	const uncovered = runJqArgs(
		`([$data.groups[]? | (.issues[]?, (.children_fingerprints // {} | keys[]))] | unique) as $covered |
		 [$cands[] | select(. as $c | $covered | index($c) | not)] | join(", ")`,
		{ cands: candsJson, data },
		"null",
		true,
	).trim();
	process.stdout.write(`new: ${uncovered} not analyzed\n`);
	process.exit(0);
}

const argv = process.argv.slice(2);
const sub = argv.shift();
switch (sub) {
	case "read": cmdRead(argv); break;
	case "write": cmdWrite(argv[0] ?? ""); break;
	case "clear": cmdClear(argv); break;
	case "lookup": cmdLookup(argv[0] ?? ""); break;
	case "needs-refresh": cmdNeedsRefresh(argv); break;
	case "--help":
	case "-h":
		process.stdout.write("Usage: parallel-groups read|write|clear|lookup|needs-refresh [args]\n");
		break;
	default:
		process.stderr.write("Usage: parallel-groups read|write|clear|lookup|needs-refresh [args]\n");
		process.exit(1);
}
