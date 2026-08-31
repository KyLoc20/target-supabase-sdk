import { join } from "node:path";
import { runtimeDataDirFromEnv } from "../upload/env";
import type { LogSpoolProcessRole } from "./interface";

export const LOG_SPOOL_DIR_NAME = "log-spool";

export function resolveLogSpoolRoot(explicit?: string): string {
    if (explicit != null && explicit.trim() !== "") {
        return explicit;
    }
    const configured = process.env.LOG_SPOOL_DIR?.trim();
    if (configured != null && configured !== "") {
        return configured;
    }
    const runtimeDir = runtimeDataDirFromEnv();
    if (runtimeDir == null) {
        throw new Error(
            "[LogSpool] spool root required: set LOG_SPOOL_DIR or LOG_PERSIST_REGISTRY_DIR / RUNTIME_DATA_DIR",
        );
    }
    return join(runtimeDir, LOG_SPOOL_DIR_NAME);
}

export function logSpoolServiceDir(spoolRoot: string, serviceId: string): string {
    return join(spoolRoot, serviceId);
}

export function logSpoolProcessDir(spoolRoot: string, serviceId: string, processRole: LogSpoolProcessRole): string {
    return join(spoolRoot, serviceId, processRole);
}
