import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ENV_FILES = [".env.local", ".env"] as const;

export interface LoadEnvFilesOptions {
    /** Files to load in order (later files do not override existing env). */
    files?: readonly string[];
    env?: NodeJS.ProcessEnv;
    /** Called after all files are merged (e.g. legacy alias normalization). */
    afterLoad?: () => void;
}

function stripQuotes(value: string): string {
    return value.replace(/^["']|["']$/g, "");
}

/** Parse one KEY=VALUE line; returns null if line should be skipped. */
export function parseEnvLine(line: string): { key: string; value: string } | null {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
        return null;
    }

    const eq = trimmed.indexOf("=");
    if (eq === -1) {
        return null;
    }

    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    return { key, value: stripQuotes(raw) };
}

export function parseEnvFileContent(content: string, env: NodeJS.ProcessEnv): void {
    for (const line of content.split("\n")) {
        const parsed = parseEnvLine(line);
        if (parsed == null) {
            continue;
        }
        if (env[parsed.key] == null || env[parsed.key] === "") {
            env[parsed.key] = parsed.value;
        }
    }
}

export function parseEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
    if (!existsSync(filePath)) {
        return;
    }
    parseEnvFileContent(readFileSync(filePath, "utf8"), env);
}

/**
 * Load `.env.local` then `.env` into `process.env` (or `options.env`).
 * Existing non-empty env values are not overwritten.
 */
export function loadEnvFiles(root: string, options?: LoadEnvFilesOptions): void {
    const env = options?.env ?? process.env;
    const files = options?.files ?? DEFAULT_ENV_FILES;

    for (const name of files) {
        parseEnvFile(resolve(root, name), env);
    }

    options?.afterLoad?.();
}
