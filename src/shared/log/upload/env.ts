import { envBool } from "../../../node/env/env-parsers";

/** Master switch — env name kept for compatibility (`LOG_PERSIST_ENABLED`). */
export function logSpoolEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    return envBool("LOG_PERSIST_ENABLED", false, env);
}

export function logPersistServiceFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env.LOG_PERSIST_SERVICE?.trim();
    return raw != null && raw !== "" ? raw : undefined;
}

export function logPersistProcessFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env.LOG_PERSIST_PROCESS?.trim();
    return raw != null && raw !== "" ? raw : undefined;
}

/** `LOG_PERSIST_REGISTRY_DIR` or `RUNTIME_DATA_DIR`. */
export function runtimeDataDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const configured = env.LOG_PERSIST_REGISTRY_DIR?.trim();
    if (configured != null && configured !== "") {
        return configured;
    }
    const runtime = env.RUNTIME_DATA_DIR?.trim();
    return runtime != null && runtime !== "" ? runtime : undefined;
}
