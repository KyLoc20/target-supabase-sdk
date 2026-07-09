import { access } from "node:fs/promises";
import { scanTargetList } from "../../core.api";
import { requireEnv } from "../env/require-env";
import type { ReadinessCheck, ReadinessCheckResult } from "./readiness.types";

export interface RequiredEnvCheckOptions {
    env?: NodeJS.ProcessEnv;
}

/** Factory: all listed env keys must be non-empty. */
export function createRequiredEnvCheck(
    name: string,
    keys: string[],
    options?: RequiredEnvCheckOptions,
): ReadinessCheck {
    return () => {
        const env = options?.env ?? process.env;
        try {
            for (const key of keys) {
                requireEnv(key, env);
            }
            return { name, ok: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { name, ok: false, detail: message };
        }
    };
}

export interface PathsExistCheckOptions {
    /** Detail string when all paths exist (default: last path). */
    successDetail?: string;
    /** Detail prefix when a path is missing. */
    missingDetail?: string;
}

/** Factory: every path must exist on disk. */
export function createPathsExistCheck(name: string, paths: string[], options?: PathsExistCheckOptions): ReadinessCheck {
    return async () => {
        for (const filePath of paths) {
            try {
                await access(filePath);
            } catch {
                return {
                    name,
                    ok: false,
                    detail: options?.missingDetail ?? `Missing ${filePath}`,
                };
            }
        }

        const detail = options?.successDetail ?? paths[paths.length - 1] ?? paths.join(", ");

        return { name, ok: true, detail };
    };
}

export interface SupabaseReachableCheckOptions {
    name?: string;
    category?: string;
    maxRows?: number;
}

/** Factory: lightweight Supabase query via {@link scanTargetList}. */
export function createSupabaseReachableCheck(options?: SupabaseReachableCheckOptions): ReadinessCheck {
    const name = options?.name ?? "supabase_connectivity";
    const category = options?.category ?? "node";
    const maxRows = options?.maxRows ?? 1;

    return async (): Promise<ReadinessCheckResult> => {
        try {
            await scanTargetList({ category, maxRows });
            return { name, ok: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { name, ok: false, detail: message };
        }
    };
}
