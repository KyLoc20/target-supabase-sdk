import { createLogger, type LoggerWithScope } from "../shared/log";
import type { ServiceLifecycle } from "./base.interface";
import { ServiceLifecycleStatus } from "./base.interface";
import { postService } from "./service.api";
import type { Service, ServiceDetails } from "./service.interface";

function formatLocalDateYmd(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** Default ACTIVE lifecycle for a newly posted Service instance row. */
export function createActiveServiceLifecycle(activeSince?: string): ServiceLifecycle {
    return {
        status: ServiceLifecycleStatus.ACTIVE,
        activeSince: activeSince ?? formatLocalDateYmd(),
        deprecatedAt: null,
        sunsetAt: null,
    };
}

/** Standard L3 Service `details` — empty apiKeys, manifest v0, ACTIVE lifecycle. */
export function defaultL3ServiceDetails(options?: { dependencies?: string[] }): ServiceDetails {
    return {
        manifestVersion: 0,
        apiKeys: [],
        dependencies: options?.dependencies ?? [],
        lifecycle: createActiveServiceLifecycle(),
    };
}

export interface PostServiceInstanceOptions {
    name: string;
    value: string;
    tagList?: string[];
    dependencies?: string[];
    logger?: LoggerWithScope;
    /** Log topic for instance-created message. Default `bootstrap`. */
    logTopic?: string;
}

/**
 * Post a new Service instance row (L3 blueprint).
 * Same `value` may exist on many rows; registry slot claim selects the live instance.
 */
export async function postServiceInstance(options: PostServiceInstanceOptions): Promise<Service> {
    const logger = options.logger ?? createLogger({ module: "service-bootstrap" });
    const logTopic = options.logTopic ?? "bootstrap";

    const result = await postService({
        name: options.name,
        value: options.value,
        tagList: options.tagList ?? [],
        details: defaultL3ServiceDetails({ dependencies: options.dependencies }),
    });

    if (!result.success || result.data == null) {
        throw new Error(result.error?.message ?? "postService failed");
    }

    logger.success("service instance created", {
        topic: logTopic,
        data: { value: options.value, serviceId: result.data.id },
    });

    return result.data;
}

export interface ServiceBootstrapResult {
    service: Service;
    baseUrl: string;
}
