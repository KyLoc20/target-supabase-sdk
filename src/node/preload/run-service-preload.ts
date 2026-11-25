import { resolve } from "node:path";
import { resolveLogMinLevel } from "../../shared/telemetry/manager/log-min-level";
import { logManager } from "../../shared/telemetry/manager/telemetry-manager";
import { loadEnvFiles, pinEnvProfileFromArgv } from "../env/load-env";
import { resolveProjectRootByPackageName } from "../env/project-root";
import type { ServicePreloadOptions } from "./service-preload.interface";

function applyRuntimeDataDirDefault(projectRoot: string, options: ServicePreloadOptions): void {
    const runtimeDir = process.env.RUNTIME_DATA_DIR?.trim();
    if (runtimeDir == null || runtimeDir === "") {
        const relative = options.runtimeDataDirRelative ?? "data/runtime";
        process.env.RUNTIME_DATA_DIR = resolve(projectRoot, relative);
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
 * Telemetry persist enable stays in app `main()` / child entry (async mkdir + probe).
 */
export function runServicePreload(options: ServicePreloadOptions): void {
    const projectRoot = resolveProjectRootByPackageName(options.callerImportMetaUrl, options.packageName);

    pinEnvProfileFromArgv();
    loadEnvFiles(projectRoot, { afterLoad: options.afterLoadEnv });

    applyRuntimeDataDirDefault(projectRoot, options);
    options.applyEnvDefaults?.(projectRoot);

    applyLogMinLevelFromEnv(options);
}
