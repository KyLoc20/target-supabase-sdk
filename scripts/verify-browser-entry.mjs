import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserBundle = join(ROOT, "dist", "browser.js");

/** `from "node:…"` in the browser bundle must not appear (Node-only code leaked in). */
const NODE_BUILTIN_IMPORT_PATTERN = /from\s+["']node:[^"']+["']/g;

const content = readFileSync(browserBundle, "utf8");
const matches = [...content.matchAll(NODE_BUILTIN_IMPORT_PATTERN)];

if (matches.length > 0) {
    console.error("[verify:browser] Node built-ins found in dist/browser.js bundle:");
    for (const match of matches) {
        console.error(`  - ${match[0]}`);
    }
    process.exit(1);
}

console.log("[verify:browser] OK — dist/browser.js bundle has no node: imports.");
