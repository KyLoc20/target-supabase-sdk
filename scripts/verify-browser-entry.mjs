import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_BUILTIN_IMPORT_PATTERN, resolveGraph } from "./verify-graph.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const browserEntry = join(DIST, "browser.js");
const graph = resolveGraph(browserEntry);
const offenders = graph.filter((file) =>
	NODE_BUILTIN_IMPORT_PATTERN.test(readFileSync(file, "utf8")),
);

if (offenders.length > 0) {
	console.error("[verify:browser] Node built-ins found in browser entry graph:");
	for (const file of offenders) {
		console.error(`  - ${file}`);
	}
	process.exit(1);
}

console.log(
	`[verify:browser] OK — ${graph.length} module(s) in browser graph, no node: imports.`,
);
