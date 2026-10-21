import { LOG_SPOOL_SERVICE_ID_ENV } from "../shared/log/spool/config";

/** Service instance id required for {@link postRegisterNode} (same env as log spool after registry claim). */
export function requireNodeServiceIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
    const serviceId = env[LOG_SPOOL_SERVICE_ID_ENV]?.trim();
    if (serviceId == null || serviceId === "") {
        throw new Error(
            `[Node] ${LOG_SPOOL_SERVICE_ID_ENV} must be set before registering a node (claim the registry slot on the service host first)`,
        );
    }
    return serviceId;
}
