/** Globally unique Config key for the declarative system service registry. */
export const TARGET_SYSTEM_REGISTRY_KEY = "target-system-registry";

/**
 * Default one EMPTY slot per known L3 service.
 * Override via `postSystemRegistryConfig` / `resetSystemRegistryConfig` payload or gc-service seed file.
 * Replica count = how many times the same `serviceValue` appears (not a separate maxInstances field).
 */
export const DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS = [
    { serviceValue: "log-service" },
    { serviceValue: "watch-service" },
    { serviceValue: "download-service" },
    { serviceValue: "storage-service" },
    { serviceValue: "gc-service" },
    { serviceValue: "upload-service" },
    { serviceValue: "cv-service" },
] as const;
