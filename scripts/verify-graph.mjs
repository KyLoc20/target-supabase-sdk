import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk static `from "./…"` imports starting at a compiled dist entry. */
export function resolveGraph(entry, seen = new Set()) {
	if (seen.has(entry)) return [];
	seen.add(entry);
	const content = readFileSync(entry, "utf8");
	const imports = [
		...content.matchAll(/from\s+["'](\.\/[^"']+)["']/g),
	].map((m) => {
		const base = join(dirname(entry), m[1]);
		return base.endsWith(".js") ? base : `${base}.js`;
	});

	const chain = [entry];
	for (const dep of imports) {
		if (statSync(dep, { throwIfNoEntry: false })?.isFile()) {
			chain.push(...resolveGraph(dep, seen));
		}
	}
	return chain;
}

export const NODE_BUILTIN_IMPORT_PATTERN =
	/from\s+["']node:(?:fs|crypto|os|path|url)/;

/** Normalize to forward slashes for stable comparisons on Windows. */
export function relDist(distRoot, filePath) {
	return filePath.slice(distRoot.length + 1).replace(/\\/g, "/");
}
