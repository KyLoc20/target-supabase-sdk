import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import resolvePlugin from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const peerDependencies = Object.keys(pkg.peerDependencies ?? {});

/** @param {string} id */
function isExternal(id) {
    if (id.startsWith("node:")) {
        return true;
    }
    return peerDependencies.some((name) => id === name || id.startsWith(`${name}/`));
}

/**
 * Single Rollup build with two entries so shared modules (e.g. supabase singleton)
 * land in one chunk — importing both target-supabase-sdk and /node must not duplicate state.
 */
/** @type {import("rollup").RollupOptions} */
export default {
    input: {
        browser: resolve(root, "src/browser.ts"),
        node: resolve(root, "src/node.ts"),
    },
    output: {
        dir: resolve(root, "dist"),
        format: "esm",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        sourcemap: true,
    },
    external: isExternal,
    plugins: [
        resolvePlugin({ extensions: [".ts", ".js"], preferBuiltins: true }),
        typescript({ tsconfig: resolve(root, "tsconfig.rollup.json") }),
    ],
};
