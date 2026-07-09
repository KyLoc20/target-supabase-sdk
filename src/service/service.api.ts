import { z } from "zod";
import { createTarget, getPossibleTarget, getTarget, type QueryFilter, validateWithSchema } from "../core.api";
import { type FieldDefinition, type SchemaDefinition, ServiceLifecycleStatus } from "./base.interface";
import {
    type Api,
    type ApiDetails,
    ApiMethod,
    CategoryApi,
    CategoryService,
    type Service,
    type ServiceDetails,
} from "./service.interface";

const targetIdSchema = z.string().trim().min(1);

const enumMemberSchema = z.object({
    key: z.string().trim().min(1),
    value: z.string(),
});

const fieldPresenceSchema = z.object({
    nullable: z.boolean(),
    optional: z.boolean(),
});

const schemaDefinitionSchema: z.ZodType<SchemaDefinition> = z.lazy(() =>
    z.discriminatedUnion("type", [
        fieldPresenceSchema.extend({
            type: z.literal("string"),
            min: z.number().optional(),
            max: z.number().optional(),
            regex: z.string().optional(),
            default: z.string().optional(),
        }),
        fieldPresenceSchema.extend({
            type: z.literal("number"),
            min: z.number().optional(),
            max: z.number().optional(),
            default: z.number().optional(),
        }),
        fieldPresenceSchema.extend({
            type: z.literal("boolean"),
            default: z.boolean().optional(),
        }),
        fieldPresenceSchema.extend({
            type: z.literal("unknown"),
            default: z.unknown().optional(),
        }),
        fieldPresenceSchema.extend({
            type: z.literal("enum"),
            members: z.array(enumMemberSchema).min(1),
            defaultKey: z.string().trim().min(1).optional(),
        }),
        fieldPresenceSchema.extend({
            type: z.literal("object"),
            fields: z.array(fieldDefinitionSchema),
            default: z.record(z.unknown()).optional(),
        }),
        fieldPresenceSchema.extend({
            type: z.literal("array"),
            items: schemaDefinitionSchema,
            min: z.number().int().nonnegative().optional(),
            max: z.number().int().nonnegative().optional(),
            default: z.unknown().optional(),
        }),
    ]),
);

const fieldDefinitionSchema: z.ZodType<FieldDefinition> = z.intersection(
    z.object({ fieldName: z.string().trim().min(1) }),
    schemaDefinitionSchema,
);

export { fieldDefinitionSchema, schemaDefinitionSchema };

export const serviceLifecycleSchema = z.object({
    status: z.nativeEnum(ServiceLifecycleStatus),
    activeSince: z.string().trim().min(1),
    deprecatedAt: z.string().nullable(),
    sunsetAt: z.string().nullable(),
});

export const apiDetailsSchema = z.object({
    method: z.nativeEnum(ApiMethod),
    path: z.string().trim().min(1),
    endpoint: z.string().trim().min(1),
    request: z.object({
        query: z.array(fieldDefinitionSchema),
    }),
    response: z.object({
        "200": z.array(fieldDefinitionSchema),
    }),
    manifestVersion: z.number().int().nonnegative(),
    lifecycle: serviceLifecycleSchema,
});

export const serviceDetailsSchema = z.object({
    manifestVersion: z.number().int().nonnegative(),
    apiKeys: z.array(z.string().trim().min(1)),
    dependencies: z.array(z.string().trim().min(1)).default([]),
    lifecycle: serviceLifecycleSchema,
});

export const postApiSchema = z.object({
    name: z.string().trim().min(1),
    value: z.string().trim().min(1),
    details: apiDetailsSchema,
    tagList: z.array(z.string()).optional().default([]),
    extra: z.string().optional(),
});

export type PostApiPayload = z.infer<typeof postApiSchema>;

export const getApiSchema = z
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

export type GetApiPayload = z.infer<typeof getApiSchema>;

export const getServiceSchema = z
    .object({
        id: targetIdSchema.optional(),
        value: z.string().trim().min(1).optional(),
        /** When set, filters `details.lifecycle.status` at query time. */
        lifecycleStatus: z.nativeEnum(ServiceLifecycleStatus).optional(),
    })
    .refine(
        (payload) => {
            const hasId = payload.id != null && payload.id !== "";
            const hasValue = payload.value != null && payload.value !== "";
            return hasId !== hasValue;
        },
        { message: "Provide exactly one of id or value" },
    );

export type GetServicePayload = z.infer<typeof getServiceSchema>;

export const postServiceSchema = z.object({
    name: z.string().trim().min(1),
    value: z.string().trim().min(1),
    details: serviceDetailsSchema,
    tagList: z.array(z.string()).optional().default([]),
    extra: z.string().optional(),
});

export type PostServicePayload = z.infer<typeof postServiceSchema>;

const apiCategoryFilter = {
    field: "category",
    operator: "eq" as const,
    value: CategoryApi.API,
};

const serviceCategoryFilter = {
    field: "category",
    operator: "eq" as const,
    value: CategoryService.SERVICE,
};

const SERVICE_LIFECYCLE_STATUS_FIELD = "details->lifecycle->>status" as const;

function buildServiceLookupFilters(payload: GetServicePayload): QueryFilter[] {
    const filters: QueryFilter[] = [serviceCategoryFilter];

    if (payload.id != null && payload.id !== "") {
        // id path: caller adds .eq("id", id) separately
    } else {
        filters.push({ field: "value", operator: "eq", value: payload.value! });
    }

    if (payload.lifecycleStatus != null) {
        filters.push({
            field: SERVICE_LIFECYCLE_STATUS_FIELD,
            operator: "eq",
            value: payload.lifecycleStatus,
        });
    }

    return filters;
}

/** Register an Api contract row (`category=api`). */
export const postApi = validateWithSchema(
    postApiSchema,
    "postApiSchema",
)(async ({ name, value, details, tagList, extra }) => {
    return createTarget<Api, PostApiPayload>({
        payload: { name, value, details, tagList, extra },
        createFn: () => ({
            name,
            value,
            category: CategoryApi.API,
            tagList,
            extra,
            details: details as ApiDetails,
        }),
    });
});

/** Fetch an Api by id or by {@link Api.value} key (`category=api`). */
export const getApi = validateWithSchema(
    getApiSchema,
    "getApiSchema",
)(async (payload) => {
    if (payload.id != null && payload.id !== "") {
        const result = await getTarget({
            id: payload.id,
            filterList: [apiCategoryFilter],
        });
        return {
            ...result,
            data: result.data as Api,
        };
    }

    const result = await getPossibleTarget({
        filterList: [apiCategoryFilter, { field: "value", operator: "eq", value: payload.value! }],
    });

    if (result.data == null) {
        return {
            ...result,
            data: undefined,
        };
    }

    return {
        ...result,
        data: result.data as Api,
    };
});

/** Fetch a Service by id or by {@link Service.value} key (`category=service`). */
export const getService = validateWithSchema(
    getServiceSchema,
    "getServiceSchema",
)(async (payload) => {
    const filterList = buildServiceLookupFilters(payload);

    if (payload.id != null && payload.id !== "") {
        const result = await getTarget({
            id: payload.id,
            filterList,
        });
        return {
            ...result,
            data: result.data as Service,
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
        data: result.data as Service,
    };
});

/** Register a Service catalog row (`category=service`). */
export const postService = validateWithSchema(
    postServiceSchema,
    "postServiceSchema",
)(async ({ name, value, details, tagList, extra }) => {
    return createTarget<Service, PostServicePayload>({
        payload: { name, value, details, tagList, extra },
        createFn: () => ({
            name,
            value,
            category: CategoryService.SERVICE,
            tagList,
            extra,
            details: details as ServiceDetails,
        }),
    });
});
