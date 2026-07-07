import { readEnv } from "./require-env.js";

export interface EnvIntOptions {
    env?: NodeJS.ProcessEnv;
    min?: number;
    max?: number;
}

export function envInt(name: string, defaultValue: number, options?: EnvIntOptions): number {
    const env = options?.env ?? process.env;
    const raw = readEnv(name, env);
    if (raw == null) {
        return defaultValue;
    }

    const value = Number(raw);
    if (!Number.isInteger(value)) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }

    const min = options?.min;
    if (min != null && value < min) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }

    const max = options?.max;
    if (max != null && value > max) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }

    return value;
}

export function envMs(name: string, defaultMs: number, options?: EnvIntOptions): number {
    return envInt(name, defaultMs, { ...options, min: options?.min ?? 1 });
}

export function envPort(defaultPort = 3100, options?: EnvIntOptions & { envKey?: string }): number {
    const envKey = options?.envKey ?? "PORT";
    return envInt(envKey, defaultPort, { ...options, min: 1, max: 65535 });
}

export interface EnvNumberOptions {
    env?: NodeJS.ProcessEnv;
    min?: number;
    /** When true, use Math.floor on parsed value. */
    floor?: boolean;
}

export function envNumber(name: string, defaultValue: number, options?: EnvNumberOptions): number {
    const env = options?.env ?? process.env;
    const raw = readEnv(name, env);
    if (raw == null) {
        return defaultValue;
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }

    const min = options?.min;
    const resolved = options?.floor === true ? Math.floor(value) : value;
    if (min != null && resolved < min) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }

    return resolved;
}

export function envBool(name: string, defaultValue = false, env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = readEnv(name, env)?.toLowerCase();
    if (raw == null) {
        return defaultValue;
    }
    return raw === "1" || raw === "true" || raw === "yes";
}
