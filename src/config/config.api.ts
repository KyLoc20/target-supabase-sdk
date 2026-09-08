import { z } from "zod";
import { getPossibleTarget, getTarget, type QueryFilter, validateWithSchema } from "../core.api";
import { CategoryConfig, type Config } from "./config.interface";

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
