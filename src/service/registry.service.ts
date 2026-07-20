/**
 * System registry — declarative service capacity (`target-system-registry` Config)
 * and startup/shutdown slot claims (`registerService` / `unregisterService`).
 *
 * Data planes:
 *   - Config `details.objects` — {@link ServiceSlot} desired layout (EMPTY / ACTIVE)
 *   - Service rows — runtime instances; guard maintains {@link ServiceDetails.runtime}
 *   - Slot release: graceful shutdown via {@link unregisterService}; monitor (later)
 *     for crashed / ungraceful exits (stale `Service.details.runtime`)
 */

import { isOptimisticLockError, updateTargetDetails } from "../core.api";
import type { Node } from "../node/node.interface";
import { createLogger } from "../shared/log";
import { getConfig } from "./config.api";
import { type Config, type ConfigDetails, TARGET_SYSTEM_REGISTRY_KEY } from "./config.interface";
import { getService } from "./service.api";
import {
    type Service,
    type ServiceDetails,
    type ServiceNodeSnapshot,
    type ServiceSlot,
    ServiceSlotStatus,
} from "./service.interface";

export { TARGET_SYSTEM_REGISTRY_KEY } from "./config.interface";

/** `details.meta.revision` on the system registry Config — optimistic-lock token. */
interface RegistryConfigMeta {
    revision: number;
}

const LOG_TOPIC_REGISTRY = "service-registry";
const DEFAULT_REGISTER_RETRY_ATTEMPTS = 5;

export interface TargetSystemRegistrySlotView {
    slot: ServiceSlot;
    /** Resolved when `slot.serviceId` is set; null for EMPTY slots. */
    service: Service | null;
}

export interface TargetSystemRegistryView {
    config: Config;
    slots: TargetSystemRegistrySlotView[];
}

export interface RegisterServiceInput {
    /** Registered runtime Service row (`category=service`). */
    service: Service;
    traceId?: string;
    maxAttempts?: number;
}

export class ServiceRegistryError extends Error {
    constructor(
        message: string,
        readonly code:
            | "REGISTRY_CONFIG_NOT_FOUND"
            | "SERVICE_NOT_DECLARED"
            | "SERVICE_SLOTS_FULL"
            | "REGISTRY_SLOT_LOST"
            | "REGISTRY_UPDATE_FAILED",
    ) {
        super(message);
        this.name = "ServiceRegistryError";
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isServiceSlotStatus(value: unknown): value is ServiceSlotStatus {
    return value === ServiceSlotStatus.EMPTY || value === ServiceSlotStatus.ACTIVE;
}

/** Defensive decode of one {@link ServiceSlot} from Config `details.objects`. */
export function parseServiceSlot(value: unknown): ServiceSlot | null {
    const source = asRecord(value);
    if (source == null) {
        return null;
    }

    const serviceValue = typeof source.serviceValue === "string" ? source.serviceValue : null;
    const status = source.status;
    if (serviceValue == null || !isServiceSlotStatus(status)) {
        return null;
    }

    let serviceId: string | null = null;
    if (source.serviceId != null) {
        if (typeof source.serviceId !== "string" || source.serviceId === "") {
            return null;
        }
        serviceId = source.serviceId;
    }

    if (status === ServiceSlotStatus.EMPTY) {
        serviceId = null;
    } else if (serviceId == null) {
        return null;
    }

    return { serviceValue, serviceId, status };
}

export function parseServiceSlots(config: Config): ServiceSlot[] {
    const slots: ServiceSlot[] = [];
    for (const object of config.details.objects) {
        const slot = parseServiceSlot(object);
        if (slot != null) {
            slots.push(slot);
        }
    }
    return slots;
}

/** Parse `details.meta.revision` from the system registry Config (defaults to 0). */
function parseRegistryRevision(rawMeta: unknown): number {
    const source = asRecord(rawMeta);
    const revision = asFiniteNumber(source?.revision);
    return revision ?? 0;
}

function nextRegistryMeta(nextRevision: number): RegistryConfigMeta {
    return { revision: nextRevision };
}

function lockOnRegistryRevision(revision: number) {
    return [{ field: "details->meta->>revision", operator: "eq" as const, value: String(revision) }];
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSystemRegistryConfig(): Promise<Config> {
    const response = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
    if (response.data == null) {
        throw new ServiceRegistryError(
            `System registry config not found (value=${TARGET_SYSTEM_REGISTRY_KEY})`,
            "REGISTRY_CONFIG_NOT_FOUND",
        );
    }
    return response.data;
}

async function resolveServiceById(serviceId: string): Promise<Service | null> {
    const response = await getService({ id: serviceId });
    return response.data ?? null;
}

/**
 * Load the global system registry Config and resolve each ACTIVE slot's Service row.
 * Read-only — does not mutate slots or heartbeats.
 */
export async function getTargetSystemRegistry(): Promise<TargetSystemRegistryView> {
    const config = await loadSystemRegistryConfig();
    const slots = parseServiceSlots(config);

    const views = await Promise.all(
        slots.map(async (slot): Promise<TargetSystemRegistrySlotView> => {
            if (slot.serviceId == null) {
                return { slot, service: null };
            }
            const service = await resolveServiceById(slot.serviceId);
            return { slot, service };
        }),
    );

    return { config, slots: views };
}

function findFirstEmptySlot(slots: ServiceSlot[], serviceValue: string): number {
    return slots.findIndex((slot) => slot.serviceValue === serviceValue && slot.status === ServiceSlotStatus.EMPTY);
}

function countSlotsForValue(
    slots: ServiceSlot[],
    serviceValue: string,
): { declared: number; active: number; empty: number } {
    let declared = 0;
    let active = 0;
    let empty = 0;
    for (const slot of slots) {
        if (slot.serviceValue !== serviceValue) {
            continue;
        }
        declared++;
        if (slot.status === ServiceSlotStatus.ACTIVE) {
            active++;
        } else if (slot.status === ServiceSlotStatus.EMPTY) {
            empty++;
        }
    }
    return { declared, active, empty };
}

/**
 * Preflight before `postService` — fail fast when registry capacity is full.
 * Prevents orphan Service rows and child process spawn when no slot is available.
 */
export async function assertRegistrySlotAvailable(serviceValue: string): Promise<void> {
    const config = await loadSystemRegistryConfig();
    const slots = parseServiceSlots(config);
    const counts = countSlotsForValue(slots, serviceValue);

    if (counts.declared === 0) {
        throw new ServiceRegistryError(
            `Service ${serviceValue} is not declared in system registry config`,
            "SERVICE_NOT_DECLARED",
        );
    }

    if (counts.empty === 0) {
        throw new ServiceRegistryError(
            `No EMPTY slot for ${serviceValue} — declared=${counts.declared}, active=${counts.active}. Refusing startup.`,
            "SERVICE_SLOTS_FULL",
        );
    }
}

/**
 * Runtime guard: this process's Service instance must still own an ACTIVE registry slot.
 * Supports N>1 replicas — checks whether `serviceId` appears in any ACTIVE slot for
 * `serviceValue`, not merely the first ACTIVE slot.
 */
export async function assertRegistrySlotOwner(input: { serviceValue: string; serviceId: string }): Promise<void> {
    const config = await loadSystemRegistryConfig();
    const slots = parseServiceSlots(config);
    const ownsSlot = slots.some(
        (slot) =>
            slot.serviceValue === input.serviceValue &&
            slot.status === ServiceSlotStatus.ACTIVE &&
            slot.serviceId === input.serviceId,
    );
    if (ownsSlot) {
        return;
    }
    const activeId = slots.find(
        (slot) =>
            slot.serviceValue === input.serviceValue &&
            slot.status === ServiceSlotStatus.ACTIVE &&
            slot.serviceId != null,
    )?.serviceId;
    throw new ServiceRegistryError(
        `Registry slot for ${input.serviceValue} is not owned by ${input.serviceId} (active=${activeId ?? "none"})`,
        "REGISTRY_SLOT_LOST",
    );
}

function isServiceValueDeclared(slots: ServiceSlot[], serviceValue: string): boolean {
    return slots.some((slot) => slot.serviceValue === serviceValue);
}

function claimSlot(slots: ServiceSlot[], slotIndex: number, serviceId: string): ServiceSlot[] {
    const next = [...slots];
    next[slotIndex] = {
        ...next[slotIndex],
        serviceId,
        status: ServiceSlotStatus.ACTIVE,
    };
    return next;
}

async function persistSlotClaim(params: { configId: string; revision: number; slots: ServiceSlot[] }): Promise<void> {
    const { configId, revision, slots } = params;

    await updateTargetDetails<Config, ConfigDetails>({
        id: configId,
        optimisticLockFilterList: lockOnRegistryRevision(revision),
        updateFn: (details) => ({
            ...details,
            meta: nextRegistryMeta(revision + 1),
            objects: slots,
        }),
    });
}

function releaseOwnedSlot(slots: ServiceSlot[], serviceId: string): ServiceSlot[] | null {
    const slotIndex = slots.findIndex(
        (slot) => slot.serviceId === serviceId && slot.status === ServiceSlotStatus.ACTIVE,
    );
    if (slotIndex < 0) {
        return null;
    }

    const next = [...slots];
    next[slotIndex] = {
        ...next[slotIndex],
        serviceId: null,
        status: ServiceSlotStatus.EMPTY,
    };
    return next;
}

/**
 * Claim one EMPTY slot for a running Service instance (`EMPTY → ACTIVE` only).
 *
 * - Each startup should `postService` a **new** instance row; do not reuse prior Service ids.
 * - Declared capacity = count of {@link ServiceSlot} rows sharing `service.value`
 * - No idempotent skip — if all slots are ACTIVE (e.g. crashed prior instance), throws
 *   `SERVICE_SLOTS_FULL` until monitor/ops releases the slot
 * - Does not write heartbeats; guard maintains {@link ServiceDetails.runtime}
 * - Graceful release: {@link unregisterService}; crash recovery: future monitor
 */
export async function registerService(input: RegisterServiceInput): Promise<void> {
    const { service } = input;
    const serviceValue = service.value;
    const maxAttempts = input.maxAttempts ?? DEFAULT_REGISTER_RETRY_ATTEMPTS;
    const logger = createLogger({
        module: "registerService",
        traceId: input.traceId,
        labels: { serviceValue, serviceId: service.id },
    });

    logger.info("开始认领系统 registry 槽位", {
        topic: LOG_TOPIC_REGISTRY,
        data: { serviceValue, serviceId: service.id },
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const config = await loadSystemRegistryConfig();
            const revision = parseRegistryRevision(config.details.meta);
            const slots = parseServiceSlots(config);

            if (!isServiceValueDeclared(slots, serviceValue)) {
                throw new ServiceRegistryError(
                    `Service ${serviceValue} is not declared in system registry config`,
                    "SERVICE_NOT_DECLARED",
                );
            }

            const emptyIndex = findFirstEmptySlot(slots, serviceValue);
            if (emptyIndex < 0) {
                throw new ServiceRegistryError(
                    `No EMPTY slot for ${serviceValue} — declared capacity is full`,
                    "SERVICE_SLOTS_FULL",
                );
            }

            const nextSlots = claimSlot(slots, emptyIndex, service.id);
            await persistSlotClaim({
                configId: config.id,
                revision,
                slots: nextSlots,
            });

            logger.info("槽位认领成功", {
                topic: LOG_TOPIC_REGISTRY,
                data: {
                    serviceValue,
                    serviceId: service.id,
                    slotIndex: emptyIndex,
                    attempt,
                    revision: revision + 1,
                },
            });
            return;
        } catch (error) {
            if (error instanceof ServiceRegistryError) {
                logger.error("槽位认领被拒绝", {
                    topic: LOG_TOPIC_REGISTRY,
                    data: { serviceValue, serviceId: service.id, code: error.code, message: error.message },
                });
                throw error;
            }

            if (isOptimisticLockError(error) && attempt < maxAttempts) {
                logger.warn("registry 乐观锁冲突，重试", {
                    topic: LOG_TOPIC_REGISTRY,
                    data: { serviceValue, serviceId: service.id, attempt, maxAttempts },
                });
                await sleep(50 * attempt);
                continue;
            }

            const message = error instanceof Error ? error.message : String(error);
            logger.error("槽位认领失败", {
                topic: LOG_TOPIC_REGISTRY,
                data: { serviceValue, serviceId: service.id, attempt, message },
            });
            throw new ServiceRegistryError(message, "REGISTRY_UPDATE_FAILED");
        }
    }

    throw new ServiceRegistryError(
        `Failed to register ${serviceValue} after ${maxAttempts} attempts`,
        "REGISTRY_UPDATE_FAILED",
    );
}

/** Resolve the ACTIVE registry slot id for a declared `serviceValue`. */
export async function resolveActiveRegistryServiceId(serviceValue: string): Promise<string | null> {
    const registry = await getTargetSystemRegistry();
    for (const { slot } of registry.slots) {
        if (slot.serviceValue === serviceValue && slot.status === ServiceSlotStatus.ACTIVE && slot.serviceId != null) {
            return slot.serviceId;
        }
    }
    return null;
}

function nodeToServiceNodeSnapshot(node: Node): ServiceNodeSnapshot {
    return {
        nodeId: node.id,
        status: node.details.status,
        lastHeartBeat: node.details.lastHeartBeat,
    };
}

export interface PatchServiceRuntimeInput {
    serviceValue: string;
    /** Prefer explicit id (N>1 replicas); falls back to first ACTIVE slot when omitted. */
    serviceId?: string;
    nodes: readonly Node[];
    lastHeartBeat: number;
}

/** Roll up Node liveness into `Service.details.runtime` (service guard only). */
export async function patchServiceRuntime(input: PatchServiceRuntimeInput): Promise<void> {
    const serviceId = input.serviceId ?? (await resolveActiveRegistryServiceId(input.serviceValue));
    if (serviceId == null) {
        return;
    }

    const nodes = input.nodes.map(nodeToServiceNodeSnapshot);

    await updateTargetDetails<Service, ServiceDetails>({
        id: serviceId,
        updateFn: (details) => ({
            ...details,
            runtime: {
                lastHeartBeat: input.lastHeartBeat,
                nodes,
            },
        }),
    });
}

/**
 * Claim a registry slot at L3 startup — propagates {@link ServiceRegistryError} (e.g. `SERVICE_SLOTS_FULL`).
 */
export async function registerServiceAtStartup(input: RegisterServiceInput): Promise<void> {
    await registerService(input);
}

/**
 * Release the ACTIVE slot owned by this Service instance (`ACTIVE → EMPTY` only).
 *
 * - Idempotent when no ACTIVE slot is bound to `service.id`
 * - Does not mutate the Service row or `details.runtime`
 * - Does not release slots owned by other instances
 */
export async function unregisterService(input: RegisterServiceInput): Promise<void> {
    const { service } = input;
    const serviceValue = service.value;
    const maxAttempts = input.maxAttempts ?? DEFAULT_REGISTER_RETRY_ATTEMPTS;
    const logger = createLogger({
        module: "unregisterService",
        traceId: input.traceId,
        labels: { serviceValue, serviceId: service.id },
    });

    logger.info("开始释放系统 registry 槽位", {
        topic: LOG_TOPIC_REGISTRY,
        data: { serviceValue, serviceId: service.id },
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const config = await loadSystemRegistryConfig();
            const revision = parseRegistryRevision(config.details.meta);
            const slots = parseServiceSlots(config);
            const nextSlots = releaseOwnedSlot(slots, service.id);

            if (nextSlots == null) {
                logger.info("无绑定槽位，跳过释放", {
                    topic: LOG_TOPIC_REGISTRY,
                    data: { serviceValue, serviceId: service.id, attempt },
                });
                return;
            }

            await persistSlotClaim({
                configId: config.id,
                revision,
                slots: nextSlots,
            });

            logger.info("槽位释放成功", {
                topic: LOG_TOPIC_REGISTRY,
                data: {
                    serviceValue,
                    serviceId: service.id,
                    attempt,
                    revision: revision + 1,
                },
            });
            return;
        } catch (error) {
            if (error instanceof ServiceRegistryError) {
                logger.error("槽位释放被拒绝", {
                    topic: LOG_TOPIC_REGISTRY,
                    data: { serviceValue, serviceId: service.id, code: error.code, message: error.message },
                });
                throw error;
            }

            if (isOptimisticLockError(error) && attempt < maxAttempts) {
                logger.warn("registry 乐观锁冲突，重试", {
                    topic: LOG_TOPIC_REGISTRY,
                    data: { serviceValue, serviceId: service.id, attempt, maxAttempts },
                });
                await sleep(50 * attempt);
                continue;
            }

            const message = error instanceof Error ? error.message : String(error);
            logger.error("槽位释放失败", {
                topic: LOG_TOPIC_REGISTRY,
                data: { serviceValue, serviceId: service.id, attempt, message },
            });
            throw new ServiceRegistryError(message, "REGISTRY_UPDATE_FAILED");
        }
    }

    throw new ServiceRegistryError(
        `Failed to unregister ${serviceValue} after ${maxAttempts} attempts`,
        "REGISTRY_UPDATE_FAILED",
    );
}

/**
 * Best-effort slot release for process shutdown — never throws.
 */
export async function unregisterServiceAtShutdown(input: RegisterServiceInput): Promise<void> {
    const logger = createLogger({
        module: "unregisterServiceAtShutdown",
        traceId: input.traceId,
        labels: { serviceValue: input.service.value, serviceId: input.service.id },
    });

    try {
        await unregisterService(input);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof ServiceRegistryError ? error.code : undefined;
        logger.warn("shutdown 释放 registry 槽位失败（best-effort）", {
            topic: LOG_TOPIC_REGISTRY,
            data: {
                serviceValue: input.service.value,
                serviceId: input.service.id,
                code,
                message,
            },
        });
    }
}
