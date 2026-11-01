import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(ROOT, "dist");
const browserBundle = join(distDir, "browser.js");
const chunksDir = join(distDir, "chunks");

/** Rollup leaves `from "node:…"` in shared chunks when `node:*` is external — breaks Webpack MV3. */
const NODE_BUILTIN_IMPORT_PATTERN = /from\s+["']node:[^"']+["']/g;
/** Side-effect imports: `import "node:crypto"` (no binding). */
const NODE_BUILTIN_SIDE_EFFECT_PATTERN = /import\s+["']node:[^"']+["']/g;

function collectNodeImportMatches(filePath, content) {
    const hits = [];
    for (const match of content.matchAll(NODE_BUILTIN_IMPORT_PATTERN)) {
        hits.push({ filePath, text: match[0] });
    }
    for (const match of content.matchAll(NODE_BUILTIN_SIDE_EFFECT_PATTERN)) {
        hits.push({ filePath, text: match[0] });
    }
    return hits;
}

/** Files reachable from the browser entry: browser.js + its static `./chunks/*` imports. */
function browserReachableBundleFiles() {
    const browserText = readFileSync(browserBundle, "utf8");
    const chunkNames = [...browserText.matchAll(/from\s+["']\.\/chunks\/([^"']+)["']/g)].map((m) => m[1]);
    const files = [browserBundle];
    for (const name of chunkNames) {
        files.push(join(chunksDir, name));
    }
    return files;
}

console.log("[verify:browser] scanning browser.js and its chunk imports for node: …");
const files = browserReachableBundleFiles();
const allHits = [];

for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    allHits.push(...collectNodeImportMatches(filePath, content));
}

if (allHits.length > 0) {
    console.error("[verify:browser] Node built-ins found in browser bundle graph:");
    for (const hit of allHits) {
        const rel = hit.filePath.startsWith(ROOT) ? hit.filePath.slice(ROOT.length + 1) : hit.filePath;
        console.error(`  - ${rel}: ${hit.text}`);
    }
    process.exit(1);
}

console.log(
    `[verify:browser] OK — ${files.length} file(s) in browser graph have no node: imports (${files.map((f) => f.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "")).join(", ")}).`,
);
