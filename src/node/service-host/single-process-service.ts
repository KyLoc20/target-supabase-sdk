import type { ServiceRegistrySession } from "../../service/registry-lifecycle";
import type { Service } from "../../service/service.interface";
import { createLogger, type LoggerWithScope } from "../../shared/log";
import { claimRegistrySlotOrExit } from "./claim-registry-slot";

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

    const session = await claimRegistrySlotOrExit({
        serviceValue: options.serviceValue,
        createInstance: options.createInstance,
        logger,
        logTopic,
    });

    try {
        await options.run({ service: session.service, session });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("fatal", { topic: logTopic, data: { message } });
        await session.release().catch(() => undefined);
        process.exit(1);
    }
}
