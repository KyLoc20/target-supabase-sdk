import { createLogger } from "../core/create-logger";
import { logPersistProcessFromEnv, logPersistServiceFromEnv, logSpoolEnabledFromEnv } from "../upload/env";
import { registerLogPersistOffer } from "../upload/hook";
import { LOG_PERSIST_TOPIC } from "../upload/logger";
import { LOG_SPOOL_SERVICE_ID_ENV, logSpoolConfigFromEnv, logSpoolServiceIdFromEnv } from "./config";
import type { EnsureLogSpoolFromEnvOptions, LogSpoolProcessRole } from "./interface";
import { resolveLogSpoolRoot } from "./paths";
import {
    assertValidLogSpoolExtraProcessRole,
    isKnownLogSpoolProcessRole,
    LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV,
} from "./process-roles";
import { enableLogSpoolWriter, getLogSpoolWriterStats, shutdownLogSpoolWriter } from "./writer";

export { logSpoolEnabledFromEnv };

export function resolveLogSpoolProcessRole(explicit?: string): LogSpoolProcessRole {
    const raw = explicit ?? logPersistProcessFromEnv();
    if (raw == null || raw === "") {
        throw new Error("[LogSpool] LOG_PERSIST_PROCESS is required when LOG_PERSIST_ENABLED=true");
    }
    if (!isKnownLogSpoolProcessRole(raw)) {
        throw new Error(
            `[LogSpool] invalid LOG_PERSIST_PROCESS: ${raw} (not a core role and not listed in ${LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV})`,
        );
    }
    return raw;
}

/**
 * Env vars for child spawn after main claims registry slot.
 * Optional when using {@link ManagedChildProcesses.spawn} — auto-injected from parent env.
 */
export function buildLogSpoolSpawnEnv(input: {
    serviceId: string;
    processRole: LogSpoolProcessRole;
}): Record<string, string> {
    return {
        [LOG_SPOOL_SERVICE_ID_ENV]: input.serviceId,
        LOG_PERSIST_PROCESS: input.processRole,
    };
}

/**
 * When persistence is enabled and parent has `LOG_SPOOL_SERVICE_ID`, map spawn `label`
 * to spool env when `label` is a known core or extra process role.
 */
export function resolveLogSpoolSpawnEnvForLabel(
    label: string,
    env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
    if (!logSpoolEnabledFromEnv(env)) {
        return {};
    }
    const serviceId = env[LOG_SPOOL_SERVICE_ID_ENV]?.trim();
    if (serviceId == null || serviceId === "") {
        return {};
    }
    if (!isKnownLogSpoolProcessRole(label, env)) {
        return {};
    }
    return buildLogSpoolSpawnEnv({ serviceId, processRole: label });
}

export async function ensureLogSpoolFromEnv(options: EnsureLogSpoolFromEnvOptions = {}): Promise<boolean> {
    if (!logSpoolEnabledFromEnv()) {
        registerLogPersistOffer(null);
        return false;
    }

    const serviceId = options.serviceId ?? logSpoolServiceIdFromEnv();
    const serviceValue = options.serviceValue ?? logPersistServiceFromEnv();
    const processRole = resolveLogSpoolProcessRole(options.processRole);

    if (serviceId == null || serviceId === "") {
        throw new Error(
            "[LogSpool] LOG_SPOOL_SERVICE_ID is required when LOG_PERSIST_ENABLED=true (set after registry claim or pass serviceId)",
        );
    }
    if (serviceValue == null || serviceValue === "") {
        throw new Error("[LogSpool] LOG_PERSIST_SERVICE is required when LOG_PERSIST_ENABLED=true");
    }

    const spoolRoot = options.spoolRoot ?? resolveLogSpoolRoot();

    await enableLogSpoolWriter({
        serviceId,
        processRole,
        serviceValue,
        spoolRoot,
        config: options.config ?? logSpoolConfigFromEnv(),
    });

    const lifecycleLogger = createLogger({ module: "log-spool" });
    lifecycleLogger.info("log spool enabled from env", {
        topic: LOG_PERSIST_TOPIC,
        data: { serviceId, processRole, serviceValue, spoolRoot },
    });

    return true;
}

export async function shutdownLogSpoolFromEnv(): Promise<void> {
    await shutdownLogSpoolWriter();
}

export function getLogSpoolStats(): ReturnType<typeof getLogSpoolWriterStats> {
    return getLogSpoolWriterStats();
}

export function validateLogSpoolPreloadEnv(env: NodeJS.ProcessEnv = process.env): void {
    if (!logSpoolEnabledFromEnv(env)) {
        return;
    }

    const missing: string[] = [];
    if (env.LOG_PERSIST_SERVICE?.trim() == null || env.LOG_PERSIST_SERVICE.trim() === "") {
        missing.push("LOG_PERSIST_SERVICE");
    }
    const runtimeDir = env.LOG_PERSIST_REGISTRY_DIR?.trim() || env.RUNTIME_DATA_DIR?.trim();
    if (runtimeDir == null || runtimeDir === "") {
        missing.push("LOG_PERSIST_REGISTRY_DIR or RUNTIME_DATA_DIR");
    }

    if (missing.length > 0) {
        throw new Error(`[LogSpool] preload env incomplete: ${missing.join(", ")}`);
    }

    for (const role of env[LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV]?.split(",") ?? []) {
        const trimmed = role.trim();
        if (trimmed === "") {
            continue;
        }
        assertValidLogSpoolExtraProcessRole(trimmed);
    }
}
