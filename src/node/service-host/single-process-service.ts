import { createLogger, type Service, ServiceRegistryError } from "../../browser";
import { claimServiceRegistrySlot, type ServiceRegistrySession } from "../../service/registry-lifecycle";
import type { LoggerWithScope } from "../../shared/log";

export interface SingleProcessServiceContext {
    service: Service;
    session: ServiceRegistrySession;
}

export interface SingleProcessServiceOptions {
    serviceValue: string;
    logger?: LoggerWithScope;
    logTopic?: string;

    prepare?: () => Promise<void>;
    createInstance: () => Promise<Service>;
    run: (ctx: SingleProcessServiceContext) => Promise<void>;
}

/**
 * Single-process L3 entry (e.g. log-service): claim registry slot then run the service body.
 * Registry release is the caller's responsibility inside `run` (e.g. TriggerNode `beforeProcessExit`).
 */
export async function runSingleProcessService(options: SingleProcessServiceOptions): Promise<void> {
    const logger = options.logger ?? createLogger({ module: "single-process-service" });
    const logTopic = options.logTopic ?? "startup";

    if (options.prepare != null) {
        await options.prepare();
    }

    let session: ServiceRegistrySession | null = null;

    try {
        session = await claimServiceRegistrySlot({
            serviceValue: options.serviceValue,
            createInstance: options.createInstance,
        });
    } catch (error) {
        if (error instanceof ServiceRegistryError && error.code === "SERVICE_SLOTS_FULL") {
            logger.critical("No EMPTY registry slot — refusing to start", {
                topic: logTopic,
                data: { serviceValue: options.serviceValue, code: error.code },
            });
            process.exit(1);
        }
        throw error;
    }

    try {
        await options.run({ service: session.service, session });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("fatal", { topic: logTopic, data: { message } });
        await session.release().catch(() => undefined);
        process.exit(1);
    }
}
