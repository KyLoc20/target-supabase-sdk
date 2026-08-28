import type { LogLevel } from "../../shared/log/log-manager";

export interface ServicePreloadOptions {
    /** `import.meta.url` from the service `scripts/preload.mjs`. */
    callerImportMetaUrl: string;
    /** package.json `name` — for resolveProjectRootByPackageName. */
    packageName: string;
    /** LOG_PERSIST_SERVICE default when persistence enabled. */
    serviceValue: string;
    /** Relative to project root; default `data/runtime`. */
    runtimeDataDirRelative?: string;
    /** Passed to loadEnvFiles `afterLoad`. */
    afterLoadEnv?: () => void;
    /** L3 hook after SDK defaults (legacy aliases, etc.). */
    applyEnvDefaults?: (projectRoot: string) => void;
    /** Default when `LOG_MIN_LEVEL` unset; SDK default is DEBUG in dev, INFO in prod. */
    defaultLogMinLevel?: LogLevel;
    /** Apply `logManager.setOptions({ minLevel })` from env (default true). */
    applyLogMinLevel?: boolean;
}
