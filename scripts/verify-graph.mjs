import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/** Static relative imports: `from "./…"`, `from "../…"`, and side-effect `import "./…"`. */
const RELATIVE_IMPORT_PATTERN = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;

function isInsideRoot(filePath, root) {
    const resolvedFile = resolve(filePath);
    const resolvedRoot = resolve(root);
    const rel = relative(resolvedRoot, resolvedFile);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(rel));
}

/** Resolve compiled ESM path: `./foo` → `foo.js`; `./dir` → `dir/index.js`. */
function resolveImportPath(fromFile, specifier) {
    const base = resolve(dirname(fromFile), specifier);
    if (base.endsWith(".js")) {
        return base;
    }
    const asFile = `${base}.js`;
    if (statSync(asFile, { throwIfNoEntry: false })?.isFile()) {
        return asFile;
    }
    const asIndex = resolve(base, "index.js");
    if (statSync(asIndex, { throwIfNoEntry: false })?.isFile()) {
        return asIndex;
    }
    return asFile;
}

/**
 * Walk static relative imports starting at a compiled dist entry.
 *
 * @param {string} entry - Absolute path to entry `.js`
 * @param {{ distRoot?: string, seen?: Set<string> }} [options]
 *   - `distRoot`: when set, only follow imports that resolve inside this directory
 */
export function resolveGraph(entry, options = {}) {
    const seen = options.seen ?? new Set();
    const distRoot = options.distRoot != null ? resolve(options.distRoot) : null;

    if (seen.has(entry)) return [];
    seen.add(entry);

    const content = readFileSync(entry, "utf8");
    const imports = [...content.matchAll(RELATIVE_IMPORT_PATTERN)].map((m) => resolveImportPath(entry, m[1]));

    const chain = [entry];
    for (const dep of imports) {
        if (distRoot != null && !isInsideRoot(dep, distRoot)) {
            continue;
        }
        if (statSync(dep, { throwIfNoEntry: false })?.isFile()) {
            chain.push(...resolveGraph(dep, { distRoot, seen }));
        }
    }
    return chain;
}

export const NODE_BUILTIN_IMPORT_PATTERN = /from\s+["']node:(?:fs|crypto|os|path|url)/;

/** Normalize to forward slashes for stable comparisons on Windows. */
export function relDist(distRoot, filePath) {
    return filePath.slice(distRoot.length + 1).replace(/\\/g, "/");
}
