/** Four-process L3 blueprint roles — always scanned by collect-log. */
export const LOG_SPOOL_CORE_PROCESS_ROLES = ["main", "guard", "scheduler", "worker"] as const;

export type LogSpoolCoreProcessRole = (typeof LOG_SPOOL_CORE_PROCESS_ROLES)[number];

/** Spool directory / `LOG_PERSIST_PROCESS` name — core or service-specific extra. */
export type LogSpoolProcessRole = LogSpoolCoreProcessRole | string;

export const LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV = "LOG_SPOOL_EXTRA_PROCESS_ROLES";

const EXTRA_ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;

function parseRoleList(raw: string | undefined): string[] {
    if (raw == null || raw.trim() === "") {
        return [];
    }
    return raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
}

/** Parse comma-separated extra roles from env (e.g. `chrome-sidecar`). */
export function logSpoolExtraProcessRolesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
    return parseRoleList(env[LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV]);
}

/** Core + extras, deduped, stable order (core first). */
export function resolveAllLogSpoolProcessRoles(env: NodeJS.ProcessEnv = process.env): LogSpoolProcessRole[] {
    const extras = logSpoolExtraProcessRolesFromEnv(env);
    const seen = new Set<string>(LOG_SPOOL_CORE_PROCESS_ROLES);
    const all: LogSpoolProcessRole[] = [...LOG_SPOOL_CORE_PROCESS_ROLES];
    for (const role of extras) {
        if (!seen.has(role)) {
            seen.add(role);
            all.push(role);
        }
    }
    return all;
}

export function isLogSpoolCoreProcessRole(value: string): value is LogSpoolCoreProcessRole {
    return (LOG_SPOOL_CORE_PROCESS_ROLES as readonly string[]).includes(value);
}

/** Whether `value` is a known spool role (core or configured extra). */
export function isKnownLogSpoolProcessRole(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
    if (isLogSpoolCoreProcessRole(value)) {
        return true;
    }
    return logSpoolExtraProcessRolesFromEnv(env).includes(value);
}

/** Validate extra role token — lowercase alphanumeric + hyphen, not a duplicate core name. */
export function assertValidLogSpoolExtraProcessRole(role: string): void {
    if (role === "" || !EXTRA_ROLE_PATTERN.test(role)) {
        throw new Error(
            `[LogSpool] invalid extra process role "${role}" — use lowercase letters, digits, hyphen (e.g. chrome-sidecar)`,
        );
    }
    if (isLogSpoolCoreProcessRole(role)) {
        throw new Error(`[LogSpool] extra process role "${role}" duplicates a core role`);
    }
}

export function mergeLogSpoolExtraProcessRolesEnv(env: NodeJS.ProcessEnv, extraRoles: readonly string[]): void {
    if (extraRoles.length === 0) {
        return;
    }
    for (const role of extraRoles) {
        assertValidLogSpoolExtraProcessRole(role);
    }
    const merged = new Set([...logSpoolExtraProcessRolesFromEnv(env), ...extraRoles]);
    env[LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV] = [...merged].join(",");
}
