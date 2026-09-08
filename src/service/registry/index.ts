/**
 * System service registry — curated re-exports only.
 * Generic Config CRUD lives in `src/config/`.
 */

export type {
    PostSystemRegistryConfigPayload,
    ResetSystemRegistryConfigPayload,
    SystemRegistrySeedSlot,
} from "./registry.api";
export {
    buildEmptyServiceSlots,
    buildSystemRegistryConfigDetails,
    postSystemRegistryConfig,
    postSystemRegistryConfigSchema,
    resetSystemRegistryConfig,
    resetSystemRegistryConfigSchema,
    systemRegistrySeedSlotSchema,
} from "./registry.api";
export { DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS, TARGET_SYSTEM_REGISTRY_KEY } from "./registry.constant";
export type { ServiceSlot } from "./registry.interface";
export { ServiceSlotStatus } from "./registry.interface";
export type {
    AppendSystemRegistryEmptySlotsInput,
    AppendSystemRegistryEmptySlotsOutcome,
    PatchServiceRuntimeInput,
    RegisterServiceInput,
    ReleasedRegistrySlot,
    ReleaseSystemRegistrySlotsByServiceIdInput,
    ReleaseSystemRegistrySlotsByServiceIdOutcome,
    ReleaseSystemRegistrySlotsInput,
    ReleaseSystemRegistrySlotsOutcome,
    TargetSystemRegistrySlotView,
    TargetSystemRegistryView,
} from "./registry.service";
export {
    appendSystemRegistryEmptySlots,
    assertRegistrySlotAvailable,
    assertRegistrySlotOwner,
    getTargetSystemRegistry,
    parseServiceSlot,
    parseServiceSlots,
    patchServiceRuntime,
    registerService,
    registerServiceAtStartup,
    releaseSystemRegistrySlots,
    releaseSystemRegistrySlotsByServiceId,
    resolveActiveRegistryServiceId,
    ServiceRegistryError,
    unregisterService,
    unregisterServiceAtShutdown,
} from "./registry.service";
export type {
    ClaimRegistrySlotInput,
    RegistrySlotGuardResult,
    RegistrySlotRuntimeState,
    ServiceRegistrySession,
} from "./registry-lifecycle";
export {
    claimServiceRegistrySlot,
    createClaimedRegistrySlotRuntimeState,
    EMPTY_REGISTRY_SLOT_RUNTIME_STATE,
    registrySlotRuntimePatchFromGuardResult,
    runRegistrySlotGuardCheck,
} from "./registry-lifecycle";
