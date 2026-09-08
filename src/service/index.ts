/**
 * Service domain public API — curated re-exports only.
 * System registry: `./registry/` (seed, claim, slot views).
 */

export type {
    EnumMembers,
    FieldDefinition,
    SchemaDefinition,
    ServiceLifecycle,
} from "./base.interface";
export { ServiceLifecycleStatus } from "./base.interface";
export type {
    AppendSystemRegistryEmptySlotsInput,
    AppendSystemRegistryEmptySlotsOutcome,
    ClaimRegistrySlotInput,
    PatchServiceRuntimeInput,
    PostSystemRegistryConfigPayload,
    RegisterServiceInput,
    RegistrySlotGuardResult,
    RegistrySlotRuntimeState,
    ReleasedRegistrySlot,
    ReleaseSystemRegistrySlotsByServiceIdInput,
    ReleaseSystemRegistrySlotsByServiceIdOutcome,
    ReleaseSystemRegistrySlotsInput,
    ReleaseSystemRegistrySlotsOutcome,
    ResetSystemRegistryConfigPayload,
    ServiceRegistrySession,
    ServiceSlot,
    SystemRegistrySeedSlot,
    TargetSystemRegistrySlotView,
    TargetSystemRegistryView,
} from "./registry/index";
export {
    appendSystemRegistryEmptySlots,
    assertRegistrySlotAvailable,
    assertRegistrySlotOwner,
    buildEmptyServiceSlots,
    buildSystemRegistryConfigDetails,
    claimServiceRegistrySlot,
    createClaimedRegistrySlotRuntimeState,
    DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS,
    EMPTY_REGISTRY_SLOT_RUNTIME_STATE,
    getTargetSystemRegistry,
    parseServiceSlot,
    parseServiceSlots,
    patchServiceRuntime,
    postSystemRegistryConfig,
    postSystemRegistryConfigSchema,
    registerService,
    registerServiceAtStartup,
    registrySlotRuntimePatchFromGuardResult,
    releaseSystemRegistrySlots,
    releaseSystemRegistrySlotsByServiceId,
    resetSystemRegistryConfig,
    resetSystemRegistryConfigSchema,
    resolveActiveRegistryServiceId,
    runRegistrySlotGuardCheck,
    ServiceRegistryError,
    ServiceSlotStatus,
    systemRegistrySeedSlotSchema,
    TARGET_SYSTEM_REGISTRY_KEY,
    unregisterService,
    unregisterServiceAtShutdown,
} from "./registry/index";
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
} from "./service.interface";
export { ApiMethod, CategoryApi, CategoryService } from "./service.interface";
export type { PostServiceInstanceOptions, ServiceBootstrapResult } from "./service-bootstrap";
export {
    createActiveServiceLifecycle,
    defaultL3ServiceDetails,
    postServiceInstance,
} from "./service-bootstrap";
