import { isDevEnvironment } from "../../../core.utils";
import { LogLevel } from "./log-manager";

/** Env key for global {@link LogManager} min level (console + log-persist when enabled). */
export const LOG_MIN_LEVEL_ENV_KEY = "LOG_MIN_LEVEL";

const LOG_LEVEL_BY_NAME: Record<string, LogLevel> = {
    DEBUG: LogLevel.DEBUG,
    INFO: LogLevel.INFO,
    SUCCESS: LogLevel.SUCCESS,
    WARN: LogLevel.WARN,
    ERROR: LogLevel.ERROR,
    CRITICAL: LogLevel.CRITICAL,
};

export interface ResolveLogMinLevelOptions {
    env?: NodeJS.ProcessEnv;
    /** When {@link LOG_MIN_LEVEL_ENV_KEY} unset; defaults to LogManager convention (DEBUG in dev, INFO in prod). */
    defaultLevel?: LogLevel;
}

function sdkDefaultLogMinLevel(): LogLevel {
    return isDevEnvironment() ? LogLevel.DEBUG : LogLevel.INFO;
}

/**
 * Parse `LOG_MIN_LEVEL` after `.env` load. Invalid values throw (same style as `envInt`).
 */
export function resolveLogMinLevel(options?: ResolveLogMinLevelOptions): LogLevel {
    const env = options?.env ?? process.env;
    const raw = env[LOG_MIN_LEVEL_ENV_KEY]?.trim().toUpperCase();
    if (raw == null || raw === "") {
        return options?.defaultLevel ?? sdkDefaultLogMinLevel();
    }

    const level = LOG_LEVEL_BY_NAME[raw];
    if (level == null) {
        throw new Error(`Invalid ${LOG_MIN_LEVEL_ENV_KEY}: ${raw}`);
    }
    return level;
}

/** Alias for {@link resolveLogMinLevel}. */
export function logMinLevelFromEnv(options?: ResolveLogMinLevelOptions): LogLevel {
    return resolveLogMinLevel(options);
}
