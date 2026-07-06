import { scanTargetList } from "../core.api";
import { generateResponse, type SupabaseResponse } from "../core.interface";
import { createLogger } from "../shared/log";
import { ServiceLifecycleStatus } from "./base.interface";
import { getService } from "./service.api";
import { CategoryService, Service } from "./service.interface";

export { CategoryApi, CategoryService, ApiMethod } from "./service.interface";
export type { Api, ApiDetails, Service, ServiceDetails } from "./service.interface";
export type {
    EnumMembers,
    FieldDefinition,
    SchemaDefinition,
    ServiceLifecycle,
} from "./base.interface";
export { ServiceLifecycleStatus } from "./base.interface";

export {
    postApi,
    postApiSchema,
    getApi,
    getApiSchema,
    postService,
    postServiceSchema,
    getService,
    getServiceSchema,
    apiDetailsSchema,
    serviceDetailsSchema,
    serviceLifecycleSchema,
    fieldDefinitionSchema,
    schemaDefinitionSchema,
} from "./service.api";
export type { PostApiPayload, GetApiPayload, PostServicePayload, GetServicePayload } from "./service.api";

export interface DiscoverServiceInput {
    /** {@link Service.value} */
    value: string;
    traceId?: string;
}

const DISCOVER_LIFECYCLE_STATUS = ServiceLifecycleStatus.ACTIVE;
const SERVICE_LIFECYCLE_STATUS_FIELD = "details->lifecycle->>status" as const;

async function lookupServicePrimary(value: string): Promise<Service | null> {
    const response = await getService({ value, lifecycleStatus: DISCOVER_LIFECYCLE_STATUS });
    return response.data ?? null;
}

async function lookupServiceByScan(value: string): Promise<Service | null> {
    const { data } = await scanTargetList<Service>({
        category: CategoryService.SERVICE,
        orderBy: { field: "value", ascending: true },
        maxRows: 1,
        filterList: [
            { field: "value", operator: "eq", value },
            {
                field: SERVICE_LIFECYCLE_STATUS_FIELD,
                operator: "eq",
                value: DISCOVER_LIFECYCLE_STATUS,
            },
        ],
    });

    return data?.[0] ?? null;
}

async function resolveDiscoverFailureReason(
    value: string
): Promise<"not-found" | "not-available"> {
    const response = await getService({ value });
    if (response.data == null) {
        return "not-found";
    }
    return "not-available";
}

/**
 * Discover a single service by {@link Service.value}.
 * Only returns services with `lifecycle.status === ACTIVE` (filtered at query time).
 *
 * Lookup: primary `getService` → fallback `scanTargetList` by value.
 */
export async function discoverService(
    input: DiscoverServiceInput
): Promise<SupabaseResponse<Service>> {
    const value = input.value.trim();
    const logger = createLogger({
        module: "discoverService",
        traceId: input.traceId,
        labels: { serviceValue: value },
    });

    if (value === "") {
        const message = "discoverService: value must not be empty";
        logger.warn(message, { topic: "service", data: { value: input.value } });
        return generateResponse.error(message, undefined, "SERVICE_VALUE_REQUIRED") as SupabaseResponse<Service>;
    }

    try {
        logger.info("开始发现服务", {
            topic: "service",
            data: { value, lifecycleStatus: DISCOVER_LIFECYCLE_STATUS },
        });

        let service = await lookupServicePrimary(value);
        let source: "primary" | "scan" = "primary";

        if (service == null) {
            logger.warn("主路径未命中，尝试 catalog 扫描回退", {
                topic: "service",
                data: { value, step: "scan-fallback", lifecycleStatus: DISCOVER_LIFECYCLE_STATUS },
            });
            service = await lookupServiceByScan(value);
            source = "scan";
        }

        if (service == null) {
            const reason = await resolveDiscoverFailureReason(value);
            if (reason === "not-available") {
                const message = `Service ${value} is not available (lifecycle is not ACTIVE)`;
                logger.warn("服务已注册但不可用", {
                    topic: "service",
                    data: { value, step: "not-available", lifecycleStatus: DISCOVER_LIFECYCLE_STATUS },
                });
                return generateResponse.error(message, undefined, "SERVICE_NOT_AVAILABLE") as SupabaseResponse<Service>;
            }

            const message = `Service not found: ${value}`;
            logger.error("服务未发现", {
                topic: "service",
                data: { value, step: "not-found", tried: ["primary", "scan"] },
            });
            return generateResponse.error(message, undefined, "SERVICE_NOT_FOUND") as SupabaseResponse<Service>;
        }

        logger.info("服务发现成功", {
            topic: "service",
            data: {
                value,
                source,
                serviceId: service.id,
                lifecycleStatus: service.details.lifecycle.status,
                apiKeyCount: service.details.apiKeys.length,
                dependencyCount: service.details.dependencies.length,
            },
        });

        return generateResponse.success(service);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("服务发现失败", {
            topic: "service",
            data: { value, message },
        });

        let service: Service | null = null;
        try {
            service = await lookupServiceByScan(value);
        } catch (fallbackError) {
            const fallbackMessage =
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            logger.error("扫描回退失败", {
                topic: "service",
                data: { value, message: fallbackMessage },
            });
            return generateResponse.error(message, undefined, "SERVICE_DISCOVER_FAILED") as SupabaseResponse<Service>;
        }

        if (service != null) {
            logger.warn("主路径异常后扫描回退成功", {
                topic: "service",
                data: { value, serviceId: service.id, primaryError: message },
            });
            return generateResponse.success(service);
        }

        return generateResponse.error(message, undefined, "SERVICE_DISCOVER_FAILED") as SupabaseResponse<Service>;
    }
}
