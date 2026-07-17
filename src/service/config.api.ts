import { z } from "zod";
import { createTarget, getPossibleTarget, getTarget, type QueryFilter, validateWithSchema } from "../core.api";
import { CategoryConfig, type Config, type ConfigDetails, TARGET_SYSTEM_REGISTRY_KEY } from "./config.interface";
import { type ServiceSlot, ServiceSlotStatus } from "./service.interface";

const targetIdSchema = z.string().trim().min(1);

export const getConfigSchema = z
    .object({
        id: targetIdSchema.optional(),
        value: z.string().trim().min(1).optional(),
    })
    .refine(
        (payload) => {
            const hasId = payload.id != null && payload.id !== "";
            const hasValue = payload.value != null && payload.value !== "";
            return hasId !== hasValue;
        },
        { message: "Provide exactly one of id or value" },
    );

export type GetConfigPayload = z.infer<typeof getConfigSchema>;

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

/** Default one EMPTY slot per known L3 service (override via payload or seed file). */
export const DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS: readonly SystemRegistrySeedSlot[] = [
    { serviceValue: "log-service" },
    { serviceValue: "watch-service" },
    { serviceValue: "download-service" },
    { serviceValue: "storage-service" },
] as const;

const configCategoryFilter: QueryFilter = {
    field: "category",
    operator: "eq",
    value: CategoryConfig.CONFIG,
};

function buildConfigLookupFilters(payload: GetConfigPayload): QueryFilter[] {
    const filters: QueryFilter[] = [configCategoryFilter];

    if (payload.id == null || payload.id === "") {
        filters.push({ field: "value", operator: "eq", value: payload.value! });
    }

    return filters;
}

/** Build EMPTY {@link ServiceSlot} rows from seed entries (one slot per array item). */
export function buildEmptyServiceSlots(seedSlots: readonly SystemRegistrySeedSlot[]): ServiceSlot[] {
    return seedSlots.map(({ serviceValue }) => ({
        serviceValue,
        serviceId: null,
        status: ServiceSlotStatus.EMPTY,
    }));
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

/** Fetch a Config by id or by {@link Config.value} key (`category=config`). */
export const getConfig = validateWithSchema(
    getConfigSchema,
    "getConfigSchema",
)(async (payload) => {
    const filterList = buildConfigLookupFilters(payload);

    if (payload.id != null && payload.id !== "") {
        const result = await getTarget({
            id: payload.id,
            filterList,
        });
        return {
            ...result,
            data: result.data as Config,
        };
    }

    const result = await getPossibleTarget({
        filterList,
    });

    if (result.data == null) {
        return {
            ...result,
            data: undefined,
        };
    }

    return {
        ...result,
        data: result.data as Config,
    };
});

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
