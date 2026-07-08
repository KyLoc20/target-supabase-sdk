import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve project root from a module URL (typically `import.meta.url`).
 * @param relativePath Path relative to the module file (default `".."` = parent directory).
 */
export function resolveProjectRootFromModule(
    importMetaUrl: string,
    relativePath = ".."
): string {
    return resolve(fileURLToPath(new URL(relativePath, importMetaUrl)));
}

/**
 * Walk upward from `importMetaUrl` until a `package.json` with matching `name` is found.
 * Use for esbuild bundles under `dist/` where a single `..` hop lands in `dist/`, not repo root.
 */
export function resolveProjectRootByPackageName(
    importMetaUrl: string,
    packageName: string
): string {
    let dir = dirname(fileURLToPath(importMetaUrl));
    for (;;) {
        const packageJsonPath = resolve(dir, "package.json");
        if (existsSync(packageJsonPath)) {
            const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
            if (pkg.name === packageName) {
                return dir;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    throw new Error(`Could not find package root for "${packageName}" from ${importMetaUrl}`);
}
