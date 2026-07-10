import { resolve } from "node:path";
import { validateLogPersistPreloadEnv } from "../../shared/log/enable-log-persist";
import { logPersistEnabledFromEnv } from "../../shared/log/log-persist.config";
import { loadEnvFiles } from "../env/load-env";
import { resolveProjectRootByPackageName } from "../env/project-root";
import type { ServicePreloadOptions } from "./service-preload.interface";

function applyServiceEnvDefaults(projectRoot: string, options: ServicePreloadOptions): void {
    if (!logPersistEnabledFromEnv()) {
        return;
    }

    const service = process.env.LOG_PERSIST_SERVICE?.trim();
    if (service == null || service === "") {
        process.env.LOG_PERSIST_SERVICE = options.serviceValue;
    }

    const runtimeDir = process.env.RUNTIME_DATA_DIR?.trim();
    if (runtimeDir == null || runtimeDir === "") {
        const relative = options.runtimeDataDirRelative ?? "data/runtime";
        process.env.RUNTIME_DATA_DIR = resolve(projectRoot, relative);
    }
}

/**
 * Unified Node `--import` preload runner (sync only).
 *
 * Phase 1 — Resolve project root from service package name
 * Phase 2 — Load `.env.local` / `.env`
 * Phase 3 — Apply SDK service env defaults + optional L3 hook
 * Phase 4 — Validate log-persist env when enabled
 * Phase 5 — Process diagnostics (TODO)
 *
 * Supabase init and log-persist enable stay in app `main()` (async).
 */
export function runServicePreload(options: ServicePreloadOptions): void {
    const projectRoot = resolveProjectRootByPackageName(options.callerImportMetaUrl, options.packageName);

    loadEnvFiles(projectRoot, { afterLoad: options.afterLoadEnv });

    applyServiceEnvDefaults(projectRoot, options);
    options.applyEnvDefaults?.(projectRoot);

    validateLogPersistPreloadEnv();

    // TODO: Phase 5 — optional unhandledRejection / uncaughtException formatters
    // (formerly watch-service preload-diagnostics.mjs)
}
