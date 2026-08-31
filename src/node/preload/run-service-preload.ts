import { resolve } from "node:path";
import { logManager } from "../../shared/log/core/log-manager";
import { resolveLogMinLevel } from "../../shared/log/core/log-min-level";
import { validateLogSpoolPreloadEnv } from "../../shared/log/spool/enable";
import { mergeLogSpoolExtraProcessRolesEnv } from "../../shared/log/spool/process-roles";
import { logSpoolEnabledFromEnv } from "../../shared/log/upload/env";
import { loadEnvFiles, pinEnvProfileFromArgv } from "../env/load-env";
import { resolveProjectRootByPackageName } from "../env/project-root";
import type { ServicePreloadOptions } from "./service-preload.interface";

function applyServiceEnvDefaults(projectRoot: string, options: ServicePreloadOptions): void {
    if (!logSpoolEnabledFromEnv()) {
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

    if (options.logSpoolExtraProcessRoles != null && options.logSpoolExtraProcessRoles.length > 0) {
        mergeLogSpoolExtraProcessRolesEnv(process.env, options.logSpoolExtraProcessRoles);
    }
}

function applyLogMinLevelFromEnv(options: ServicePreloadOptions): void {
    if (options.applyLogMinLevel === false) {
        return;
    }
    logManager.setOptions({
        minLevel: resolveLogMinLevel({ defaultLevel: options.defaultLogMinLevel }),
    });
}

/**
 * Unified Node `--import` preload runner (sync only).
 *
 * Phase 1 — Resolve project root from service package name
 * Phase 2 — Load env files (`.env.local` / `.env`, or `.env.prod` when `--prod`)
 * Phase 3 — Apply SDK service env defaults + optional L3 hook
 * Phase 3½ — Apply LOG_MIN_LEVEL → logManager.minLevel (after env load)
 * Phase 4 — Validate log-persist env when enabled
 * Phase 5 — Process diagnostics (TODO)
 *
 * Supabase init and log-persist enable stay in app `main()` (async).
 */
export function runServicePreload(options: ServicePreloadOptions): void {
    const projectRoot = resolveProjectRootByPackageName(options.callerImportMetaUrl, options.packageName);

    pinEnvProfileFromArgv();
    loadEnvFiles(projectRoot, { afterLoad: options.afterLoadEnv });

    applyServiceEnvDefaults(projectRoot, options);
    options.applyEnvDefaults?.(projectRoot);

    applyLogMinLevelFromEnv(options);

    validateLogSpoolPreloadEnv();

    // TODO: Phase 5 — optional unhandledRejection / uncaughtException formatters
    // (formerly watch-service preload-diagnostics.mjs)
}
