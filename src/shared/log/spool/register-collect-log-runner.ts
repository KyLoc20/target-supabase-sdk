import { LOG_TOPIC_TRIGGER } from "../../../trigger/trigger.constant";
import { TriggerManager } from "../../../trigger/trigger-manager";
import { logSpoolEnabledFromEnv } from "../upload/env";
import { spoolLogger } from "../upload/logger";
import { runCollectLogTick } from "./collector";
import { logSpoolConfigFromEnv } from "./config";

export const COLLECT_LOG_RUNNER_KEY = "collect-log";

export interface RegisterCollectLogRunnerOptions {
    serviceValue: string;
    getServiceId: () => Promise<string | null>;
    runnerKey?: string;
    intervalMs?: number;
    initialDelayMs?: number;
    spoolRoot?: string;
}

/**
 * Guard process only — uploads `.tmp` spool batches and runs GC.
 * Register before {@link TriggerNode.start} (e.g. in {@link ServiceGuardNode.create}).
 */
export function registerCollectLogRunner(options: RegisterCollectLogRunnerOptions): void {
    if (!logSpoolEnabledFromEnv()) {
        return;
    }

    const config = logSpoolConfigFromEnv();
    const intervalMs = options.intervalMs ?? config.collectIntervalMs;

    TriggerManager.registerRunner({
        key: options.runnerKey ?? COLLECT_LOG_RUNNER_KEY,
        intervalMs,
        initialDelayMs: options.initialDelayMs ?? 0,
        retryCount: 1,
        fn: async (ctx) => {
            const serviceId = await options.getServiceId();
            if (serviceId == null) {
                ctx.logger.warn("collect-log skipped — serviceId unavailable", { topic: LOG_TOPIC_TRIGGER });
                return;
            }

            const result = await runCollectLogTick({
                serviceId,
                serviceValue: options.serviceValue,
                spoolRoot: options.spoolRoot,
                config,
            });

            if (result.uploaded > 0 || result.failed > 0) {
                ctx.logger.info("collect-log runner finished", {
                    topic: LOG_TOPIC_TRIGGER,
                    data: result,
                });
            }
        },
    });

    spoolLogger.info("collect-log runner registered", {
        intervalMs,
        serviceValue: options.serviceValue,
    });
}
