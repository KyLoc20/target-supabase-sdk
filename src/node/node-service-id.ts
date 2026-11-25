/**
 * Claimed Service instance id — set by {@link createServiceHost} / {@link runSingleProcessService}
 * after registry claim; inherited by child processes via spawn env.
 *
 * Used by {@link requireNodeServiceIdFromEnv} → {@link postRegisterNode} (`Node.name` = owning instance).
 * Not related to local telemetry persist.
 */
export const SERVICE_ID_ENV = "TARGET_SUPABASE_SDK_SERVICE_ID";

/** One-release dual-read only; hosts must not write this key. */
const LEGACY_SERVICE_ID_ENV = "LOG_SPOOL_SERVICE_ID";

function readServiceId(env: NodeJS.ProcessEnv): string | undefined {
    const primary = env[SERVICE_ID_ENV]?.trim();
    if (primary != null && primary !== "") {
        return primary;
    }
    const legacy = env[LEGACY_SERVICE_ID_ENV]?.trim();
    if (legacy != null && legacy !== "") {
        return legacy;
    }
    return undefined;
}

/** Service instance id required for {@link postRegisterNode}. */
export function requireNodeServiceIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
    const serviceId = readServiceId(env);
    if (serviceId == null || serviceId === "") {
        throw new Error(
            `[Node] ${SERVICE_ID_ENV} must be set before registering a node (claim the registry slot on the service host first)`,
        );
    }
    return serviceId;
}
