/**
 * Service catalog discovery — resolve an ACTIVE {@link Service} manifest by `value`.
 *
 * Distinct from {@link getTargetSystemRegistry} / {@link registerService}: those manage
 * runtime slot capacity on the `target-system-registry` Config; this reads the catalog row only.
 */

import { generateResponse, type SupabaseResponse } from "../core.interface";
import { createLogger } from "../shared/log";
import { ServiceLifecycleStatus } from "./base.interface";
import { getService } from "./service.api";
import type { Service } from "./service.interface";

export interface DiscoverServiceInput {
    /** {@link Service.value} */
    value: string;
    traceId?: string;
}

const DISCOVER_LIFECYCLE_STATUS = ServiceLifecycleStatus.ACTIVE;
const LOG_TOPIC = "service";

async function resolveDiscoverFailureReason(value: string): Promise<"not-found" | "not-available"> {
    const response = await getService({ value });
    return response.data == null ? "not-found" : "not-available";
}

/**
 * Discover a single service catalog row by {@link Service.value}.
 * Only returns services with `lifecycle.status === ACTIVE` (filtered at query time).
 */
export async function discoverService(input: DiscoverServiceInput): Promise<SupabaseResponse<Service>> {
    const value = input.value.trim();
    const logger = createLogger({
        module: "discoverService",
        traceId: input.traceId,
        labels: { serviceValue: value },
    });

    if (value === "") {
        const message = "discoverService: value must not be empty";
        logger.warn(message, { topic: LOG_TOPIC, data: { value: input.value } });
        return generateResponse.error(message, undefined, "SERVICE_VALUE_REQUIRED") as SupabaseResponse<Service>;
    }

    logger.info("开始发现服务", {
        topic: LOG_TOPIC,
        data: { value, lifecycleStatus: DISCOVER_LIFECYCLE_STATUS },
    });

    const response = await getService({ value, lifecycleStatus: DISCOVER_LIFECYCLE_STATUS });
    if (response.data != null) {
        const service = response.data;
        logger.info("服务发现成功", {
            topic: LOG_TOPIC,
            data: {
                value,
                serviceId: service.id,
                lifecycleStatus: service.details.lifecycle.status,
                apiKeyCount: service.details.apiKeys.length,
                dependencyCount: service.details.dependencies.length,
            },
        });
        return generateResponse.success(service);
    }

    const reason = await resolveDiscoverFailureReason(value);
    if (reason === "not-available") {
        const message = `Service ${value} is not available (lifecycle is not ACTIVE)`;
        logger.warn("服务已注册但不可用", {
            topic: LOG_TOPIC,
            data: { value, lifecycleStatus: DISCOVER_LIFECYCLE_STATUS },
        });
        return generateResponse.error(message, undefined, "SERVICE_NOT_AVAILABLE") as SupabaseResponse<Service>;
    }

    const message = `Service not found: ${value}`;
    logger.error("服务未发现", { topic: LOG_TOPIC, data: { value } });
    return generateResponse.error(message, undefined, "SERVICE_NOT_FOUND") as SupabaseResponse<Service>;
}
