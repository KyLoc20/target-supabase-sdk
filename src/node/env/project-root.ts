import { resolve } from "node:path";
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
