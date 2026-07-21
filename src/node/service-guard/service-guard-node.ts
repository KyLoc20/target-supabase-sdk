import type { LoggerWithScope } from "../../shared/log";
import { TriggerNode } from "../../trigger/trigger-node";
import { registerServiceGuardRunner } from "./register-service-guard-runner";
import { runReadinessGate } from "./run-readiness-gate";
import type { ServiceGuardNodeOptions } from "./service-guard.interface";

/**
 * L3 guard process TriggerNode: readiness gate, TaskNode worker spawn owner,
 * and {@link registerServiceGuardRunner} tick (registry slot + liveness + runtime).
 *
 * Use {@link ServiceGuardNode.create} so the guard runner is registered before `start()`.
 */
class ServiceGuardNode extends TriggerNode {
    private readonly options: ServiceGuardNodeOptions;

    private constructor(options: ServiceGuardNodeOptions) {
        super({
            requireRunners: true,
            beforeProcessExit: options.beforeProcessExit,
        });
        this.options = options;
    }

    /** Register the guard runner and return a ready-to-start node. */
    static create(options: ServiceGuardNodeOptions): ServiceGuardNode {
        registerServiceGuardRunner({
            serviceValue: options.serviceValue,
            logTopic: options.logTopic,
            ...options.guardRunner,
        });
        return new ServiceGuardNode(options);
    }

    protected async onBeforeRegisterNode(nodeLogger: LoggerWithScope): Promise<void> {
        await runReadinessGate({
            checks: this.options.readinessChecks,
            onReport: this.options.onReadinessReport,
            logger: nodeLogger,
            logTopic: this.options.logTopic,
        });

        await super.onBeforeRegisterNode(nodeLogger);

        nodeLogger.info("Spawning TaskNode worker (single spawn owner)", {
            topic: this.options.logTopic ?? "guard",
        });
        await this.options.spawnWorker("guard:readiness-passed");
        this.options.onWorkerSpawned?.();
    }
}

export { ServiceGuardNode };
