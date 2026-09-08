import { z } from "zod";
import { getConfig } from "../../config/config.api";
import { CategoryConfig, type Config, type ConfigDetails } from "../../config/config.interface";
import {
    createTarget,
    isOptimisticLockError,
    type QueryFilter,
    updateTargetDetails,
    validateWithSchema,
} from "../../core.api";
import { generateResponse } from "../../core.interface";
import { DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS, TARGET_SYSTEM_REGISTRY_KEY } from "./registry.constant";
import { type ServiceSlot, ServiceSlotStatus } from "./registry.interface";

/** One declarative EMPTY slot entry for seeding the system registry. */
export const systemRegistrySeedSlotSchema = z.object({
    serviceValue: z.string().trim().min(1),
});

export type SystemRegistrySeedSlot = z.infer<typeof systemRegistrySeedSlotSchema>;

export const postSystemRegistryConfigSchema = z.object({
    /** When omitted, {@link DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS} is used. */
    slots: z.array(systemRegistrySeedSlotSchema).min(1).optional(),
    tagList: z.array(z.string()).optional().default([]),
});

export type PostSystemRegistryConfigPayload = z.infer<typeof postSystemRegistryConfigSchema>;

/** Same payload shape as {@link postSystemRegistryConfig} — replaces slots with fresh EMPTY rows. */
export const resetSystemRegistryConfigSchema = postSystemRegistryConfigSchema;

export type ResetSystemRegistryConfigPayload = PostSystemRegistryConfigPayload;

const DEFAULT_RESET_RETRY_ATTEMPTS = 5;
const RESET_RETRY_DELAY_MS = 50;

const configCategoryFilter: QueryFilter = {
    field: "category",
    operator: "eq",
    value: CategoryConfig.CONFIG,
};

/** Build EMPTY {@link ServiceSlot} rows from seed entries (one slot per array item). */
export function buildEmptyServiceSlots(seedSlots: readonly SystemRegistrySeedSlot[]): ServiceSlot[] {
    return seedSlots.map(({ serviceValue }) => ({
        serviceValue,
        serviceId: null,
        status: ServiceSlotStatus.EMPTY,
    }));
}

function parseRegistryRevision(rawMeta: unknown): number {
    const source = typeof rawMeta === "object" && rawMeta !== null ? (rawMeta as Record<string, unknown>) : null;
    const revision = source?.revision;
    return typeof revision === "number" && Number.isFinite(revision) ? revision : 0;
}

function lockOnRegistryRevision(revision: number): QueryFilter[] {
    return [{ field: "details->meta->>revision", operator: "eq", value: String(revision) }];
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build `ConfigDetails` for the globally unique system registry row. */
export function buildSystemRegistryConfigDetails(slots: readonly ServiceSlot[]): ConfigDetails {
    return {
        manifestVersion: 0,
        loaderKey: TARGET_SYSTEM_REGISTRY_KEY,
        meta: { revision: 0 },
        objects: [...slots],
    };
}

/**
 * Insert the globally unique system registry Config (`category=config`,
 * `value=target-system-registry`). Rejects duplicates via `checkRedundancyFilterList`.
 */
export const postSystemRegistryConfig = validateWithSchema(
    postSystemRegistryConfigSchema,
    "postSystemRegistryConfigSchema",
)(async ({ slots, tagList }) => {
    const seedSlots = [...(slots ?? DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS)];
    const serviceSlots = buildEmptyServiceSlots(seedSlots);
    const details = buildSystemRegistryConfigDetails(serviceSlots);

    return createTarget<Config, PostSystemRegistryConfigPayload>({
        payload: { slots: seedSlots, tagList },
        checkRedundancyFilterList: [
            configCategoryFilter,
            { field: "value", operator: "eq", value: TARGET_SYSTEM_REGISTRY_KEY },
        ],
        createFn: () => ({
            name: TARGET_SYSTEM_REGISTRY_KEY,
            value: TARGET_SYSTEM_REGISTRY_KEY,
            category: CategoryConfig.CONFIG,
            tagList,
            details,
        }),
    });
});

/**
 * Replace the system registry slot layout with fresh EMPTY rows.
 * Creates the row when missing (same as {@link postSystemRegistryConfig}).
 * Clears ACTIVE slot bindings — use for dev recovery after crashes or layout changes.
 */
export const resetSystemRegistryConfig = validateWithSchema(
    resetSystemRegistryConfigSchema,
    "resetSystemRegistryConfigSchema",
)(async ({ slots, tagList }) => {
    const seedSlots = [...(slots ?? DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS)];
    const serviceSlots = buildEmptyServiceSlots(seedSlots);

    const existing = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
    if (existing.data == null) {
        return postSystemRegistryConfig({ slots: seedSlots, tagList });
    }

    const configId = existing.data.id;

    for (let attempt = 1; attempt <= DEFAULT_RESET_RETRY_ATTEMPTS; attempt += 1) {
        try {
            const fresh = await getConfig({ id: configId });
            if (fresh.data == null) {
                throw new Error(`System registry config disappeared during reset (id=${configId})`);
            }

            const revision = parseRegistryRevision(fresh.data.details.meta);
            const updated = await updateTargetDetails<Config, ConfigDetails>({
                id: configId,
                optimisticLockFilterList: lockOnRegistryRevision(revision),
                updateFn: (details) => ({
                    ...details,
                    meta: { revision: revision + 1 },
                    objects: serviceSlots,
                }),
            });

            return generateResponse.success<Config>(updated);
        } catch (error) {
            if (isOptimisticLockError(error) && attempt < DEFAULT_RESET_RETRY_ATTEMPTS) {
                await sleep(RESET_RETRY_DELAY_MS * attempt);
                continue;
            }
            throw error;
        }
    }

    throw new Error("[resetSystemRegistryConfig] Optimistic lock retries exhausted");
});
