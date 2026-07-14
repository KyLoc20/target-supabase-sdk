import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ENV_FILES = [".env.local", ".env"] as const;
const PROD_ENV_FILES = [".env.prod"] as const;

export const SERVICE_ENV_PROFILE_ENV_KEY = "SERVICE_ENV_PROFILE" as const;
export const SERVICE_ENV_PROFILE_PROD = "prod" as const;
export const CLI_PROD_FLAG = "--prod" as const;

export interface EnvProfileFromProcessOptions {
    env?: NodeJS.ProcessEnv;
    argv?: readonly string[];
}

/** Resolve active env profile from `SERVICE_ENV_PROFILE` or `--prod` on argv. */
export function envProfileFromProcess(options?: EnvProfileFromProcessOptions): string | undefined {
    const env = options?.env ?? process.env;
    const argv = options?.argv ?? process.argv;
    const fromEnv = env[SERVICE_ENV_PROFILE_ENV_KEY]?.trim();
    if (fromEnv != null && fromEnv !== "") {
        return fromEnv;
    }
    if (argv.includes(CLI_PROD_FLAG)) {
        return SERVICE_ENV_PROFILE_PROD;
    }
    return undefined;
}

/** Default env file list for a profile (`prod` → `.env.prod`; otherwise `.env.local` → `.env`). */
export function resolveDefaultEnvFiles(profile?: string): readonly string[] {
    if (profile === SERVICE_ENV_PROFILE_PROD) {
        return PROD_ENV_FILES;
    }
    return DEFAULT_ENV_FILES;
}

/** Pin `SERVICE_ENV_PROFILE=prod` when `--prod` is on argv (for child process inheritance). */
export function pinEnvProfileFromArgv(
    env: NodeJS.ProcessEnv = process.env,
    argv: readonly string[] = process.argv,
): void {
    if (env[SERVICE_ENV_PROFILE_ENV_KEY]?.trim()) {
        return;
    }
    if (argv.includes(CLI_PROD_FLAG)) {
        env[SERVICE_ENV_PROFILE_ENV_KEY] = SERVICE_ENV_PROFILE_PROD;
    }
}

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
 * Load env files into `process.env` (or `options.env`).
 * Default files: `.env.local` → `.env`, or `.env.prod` when profile is `prod` / `--prod`.
 * Existing non-empty env values are not overwritten.
 */
export function loadEnvFiles(root: string, options?: LoadEnvFilesOptions): void {
    const env = options?.env ?? process.env;
    const files = options?.files ?? resolveDefaultEnvFiles(envProfileFromProcess({ env }));

    for (const name of files) {
        parseEnvFile(resolve(root, name), env);
    }

    options?.afterLoad?.();
}
