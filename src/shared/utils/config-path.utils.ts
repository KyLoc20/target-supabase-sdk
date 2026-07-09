import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Directory containing a config file — anchor for paths declared **inside** that file.
 */
export function getConfigFileDir(configFilePath: string): string {
    return dirname(configFilePath);
}

/**
 * Resolve a path from a config file's directory.
 *
 * - Absolute `pathInConfig` → returned as-is
 * - Relative `pathInConfig` → `resolve(dirname(configFilePath), pathInConfig)`
 *
 * **Not** relative to `process.cwd()`. See `.cursor/skills/config-file-relative-paths/SKILL.md`.
 */
export function resolvePathFromConfigFile(configFilePath: string, pathInConfig: string): string {
    const trimmed = pathInConfig.trim();
    if (isAbsolute(trimmed)) {
        return trimmed;
    }
    return resolve(getConfigFileDir(configFilePath), trimmed);
}

/**
 * Resolve a path from an explicit base directory (e.g. task package dir for `entry`).
 * Same rules as {@link resolvePathFromConfigFile}, but base is already known.
 */
export function resolvePathFromBaseDir(baseDir: string, path: string): string {
    const trimmed = path.trim();
    if (isAbsolute(trimmed)) {
        return trimmed;
    }
    return resolve(baseDir, trimmed);
}

/**
 * Resolve a path from `cwd` — for **discovering** config files, not for fields inside them.
 */
export function resolvePathFromCwd(cwd: string, path: string): string {
    const trimmed = path.trim();
    if (isAbsolute(trimmed)) {
        return trimmed;
    }
    return resolve(cwd, trimmed);
}

export async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export interface ResolveFirstExistingPathOptions {
    /** When set, only this path is tried (resolved from `cwd` if relative). */
    explicitPath?: string;
    /** Relative to `cwd`, tried in order when `explicitPath` is omitted. */
    candidatePaths: string[];
}

/**
 * Find the first existing file path: optional explicit path, else scan `candidatePaths` under `cwd`.
 */
export async function resolveFirstExistingPath(
    cwd: string,
    options: ResolveFirstExistingPathOptions,
): Promise<string | null> {
    const { explicitPath, candidatePaths } = options;

    if (explicitPath != null && explicitPath.trim() !== "") {
        const resolved = resolvePathFromCwd(cwd, explicitPath);
        return (await pathExists(resolved)) ? resolved : null;
    }

    for (const candidate of candidatePaths) {
        const resolved = join(cwd, candidate);
        if (await pathExists(resolved)) {
            return resolved;
        }
    }

    return null;
}

/** `file://` href for Node dynamic `import()` of a local module. */
export function toFileImportHref(filePath: string): string {
    const trimmed = filePath.trim();
    if (trimmed.includes("://")) {
        return trimmed;
    }
    return pathToFileURL(trimmed).href;
}

/** Native ESM import of a `.js` / `.mjs` config; supports `export default` or named export object. */
export async function importJsConfigModule(configPath: string): Promise<unknown> {
    const mod = await import(toFileImportHref(configPath));
    return mod.default ?? mod;
}
