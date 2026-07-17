/**
 * Service domain public API — curated re-exports only.
 */

export type {
    EnumMembers,
    FieldDefinition,
    SchemaDefinition,
    ServiceLifecycle,
} from "./base.interface";
export { ServiceLifecycleStatus } from "./base.interface";
export type { GetConfigPayload, PostSystemRegistryConfigPayload, SystemRegistrySeedSlot } from "./config.api";
export {
    buildEmptyServiceSlots,
    buildSystemRegistryConfigDetails,
    DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS,
    getConfig,
    getConfigSchema,
    postSystemRegistryConfig,
    postSystemRegistryConfigSchema,
    systemRegistrySeedSlotSchema,
} from "./config.api";
export type { Config, ConfigDetails } from "./config.interface";
export { CategoryConfig, TARGET_SYSTEM_REGISTRY_KEY } from "./config.interface";
export type { DiscoverServiceInput } from "./discover.service";
export { discoverService } from "./discover.service";
export type {
    PatchServiceRuntimeInput,
    RegisterServiceInput,
    TargetSystemRegistrySlotView,
    TargetSystemRegistryView,
} from "./registry.service";
export {
    getTargetSystemRegistry,
    parseServiceSlot,
    parseServiceSlots,
    patchServiceRuntime,
    registerService,
    registerServiceAtStartup,
    resolveActiveRegistryServiceId,
    ServiceRegistryError,
    unregisterService,
    unregisterServiceAtShutdown,
} from "./registry.service";
export type { GetApiPayload, GetServicePayload, PostApiPayload, PostServicePayload } from "./service.api";
export {
    apiDetailsSchema,
    fieldDefinitionSchema,
    getApi,
    getApiSchema,
    getService,
    getServiceSchema,
    postApi,
    postApiSchema,
    postService,
    postServiceSchema,
    schemaDefinitionSchema,
    serviceDetailsSchema,
    serviceLifecycleSchema,
    serviceNodeSnapshotSchema,
    serviceRuntimeSchema,
} from "./service.api";
export type {
    Api,
    ApiDetails,
    Service,
    ServiceDetails,
    ServiceNodeSnapshot,
    ServiceRuntime,
    ServiceSlot,
} from "./service.interface";
export { ApiMethod, CategoryApi, CategoryService, ServiceSlotStatus } from "./service.interface";
