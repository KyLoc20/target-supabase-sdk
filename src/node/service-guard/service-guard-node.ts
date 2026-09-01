import { createLogger, type LoggerWithScope } from "../../shared/log";
import { registerCollectLogRunner } from "../../shared/log/spool/register-collect-log-runner";
import { getErrorMessage } from "../../shared/utils/error.utils";
import { TriggerNode } from "../../trigger/trigger-node";
import type { NodeLoopContext } from "../node-runtime.base";
import { pollUntil } from "../readiness/poll-until";
import { runReadinessGate } from "../readiness/run-readiness-gate";
import type { GuardRuntimeSlice } from "../runtime-state/service-runtime-state.types";
import { registerServiceGuardRunner } from "./register-service-guard-runner";
import type { ServiceGuardNodeOptions } from "./service-guard.interface";
import { markWorkerSpawned } from "./worker-spawn-cooldown";

const SILENT_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 240_000, 300_000] as const;
const SILENT_EVENT_LIMIT = 32;
const DEFAULT_BUSINESS_READY_TIMEOUT_MS = 180_000;

/**
 * L3 guard process TriggerNode: readiness gate, business-node spawn owner,
 * and {@link registerServiceGuardRunner} tick (registry slot + liveness + runtime).
 *
 * Consecutive heartbeat failure enters silent mode (no process exit). Recovery
 * respawns business nodes; leaving silent requires heartbeat + all nodes ready.
 *
 * Use {@link ServiceGuardNode.create} so the guard runner is registered before `start()`.
 */
class ServiceGuardNode extends TriggerNode {
    private readonly options: ServiceGuardNodeOptions;
    private readonly businessReadyTimeoutMs: number;
    private mode: GuardRuntimeSlice["mode"] = "healthy";
    private silentBackoffIndex = 0;
    private silentEvents: GuardRuntimeSlice["silentEvents"] = [];
    private recoverPromise: Promise<void> | null = null;

    private constructor(options: ServiceGuardNodeOptions) {
        super({
            requireRunners: true,
            beforeProcessExit: options.beforeProcessExit,
        });
        this.options = options;
        this.businessReadyTimeoutMs = options.businessReadyTimeoutMs ?? DEFAULT_BUSINESS_READY_TIMEOUT_MS;
    }

    /** Register the guard runner and return a ready-to-start node. */
    static create(options: ServiceGuardNodeOptions): ServiceGuardNode {
        registerServiceGuardRunner({
            ...options.guardRunner,
            serviceValue: options.serviceValue,
            logTopic: options.logTopic,
            spawnWorker: options.spawnBusinessNodes,
        });
        registerCollectLogRunner({
            serviceValue: options.serviceValue,
            getServiceId: options.guardRunner.getServiceId,
        });
        return new ServiceGuardNode(options);
    }

    protected isSilenced(): boolean {
        return this.mode !== "healthy";
    }

    protected getLoopIntervalMs(): number {
        if (this.mode === "silent") {
            return SILENT_BACKOFF_MS[this.silentBackoffIndex] ?? 300_000;
        }
        return super.getLoopIntervalMs();
    }

    protected async onHealthCheckFailed(_ctx: NodeLoopContext): Promise<void> {
        if (this.mode !== "healthy") {
            this.bumpSilentBackoff();
            await this.persistGuard({
                lastDecision: "silent_heartbeat_fail",
                silentConsecutiveFailures: this.silentConsecutiveFailures(),
                silentBackoffMs: this.getLoopIntervalMs(),
                silentLastHeartbeatAt: new Date().toISOString(),
            });
            return;
        }
        await this.enterSilent("heartbeat:consecutive-failures");
    }

    protected async onHeartbeatRecovered(ctx: NodeLoopContext): Promise<void> {
        if (this.mode !== "silent") {
            return;
        }
        await this.recoverFromSilent(ctx);
    }

    protected async onBeforeRegisterNode(nodeLogger: LoggerWithScope): Promise<void> {
        await runReadinessGate({
            checks: this.options.readinessChecks,
            onReport: this.options.onReadinessReport,
            logger: nodeLogger,
            logTopic: this.options.logTopic,
        });

        await super.onBeforeRegisterNode(nodeLogger);

        nodeLogger.info("Spawning business nodes", {
            topic: this.options.logTopic ?? "guard",
        });
        await this.options.spawnBusinessNodes("guard:readiness-passed");
        markWorkerSpawned();
        this.options.onWorkerSpawned?.();

        await this.waitUntilBusinessReady();
        await this.persistGuard({
            mode: "healthy",
            lastDecision: "bootstrap_ready",
        });
    }

    protected async runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void> {
        await super.runLoopSteps(ctx, heartbeatOk);
        if (this.mode !== "healthy" || !heartbeatOk) {
            return;
        }
        // Idempotent — respawn exited children without entering silent (worker stale is the runner's job).
        try {
            await this.options.spawnBusinessNodes("guard:ensure-business");
        } catch (error) {
            this.createGuardLogger().warn("ensure-business spawn failed", {
                topic: this.options.logTopic ?? "guard",
                data: { error: getErrorMessage(error) },
            });
        }
    }

    private silentConsecutiveFailures(): number {
        return this.silentBackoffIndex + 1;
    }

    private bumpSilentBackoff(): void {
        if (this.silentBackoffIndex < SILENT_BACKOFF_MS.length - 1) {
            this.silentBackoffIndex += 1;
        }
    }

    private async enterSilent(reason: string): Promise<void> {
        this.mode = "silent";
        this.silentBackoffIndex = 0;
        const enteredAt = new Date().toISOString();
        this.pushEvent("enter", reason);
        await this.persistGuard({
            mode: "silent",
            lastDecision: `silent:${reason}`,
            silentEnteredAt: enteredAt,
            silentLastHeartbeatAt: enteredAt,
            silentBackoffMs: SILENT_BACKOFF_MS[0],
            silentConsecutiveFailures: 1,
            silentRecoveryAttempt: 0,
            silentEvents: this.silentEvents,
        });

        const logger = this.createGuardLogger();
        logger.warn("Entering silent mode — service unavailable until heartbeat + business nodes recover", {
            topic: this.options.logTopic ?? "guard",
            data: { reason },
        });

        try {
            await this.options.stopBusinessNodes();
        } catch (error) {
            logger.warn("stopBusinessNodes failed (best-effort)", {
                topic: this.options.logTopic ?? "guard",
                data: { error: getErrorMessage(error) },
            });
        }
    }

    private async recoverFromSilent(ctx: NodeLoopContext): Promise<void> {
        if (this.recoverPromise != null) {
            return this.recoverPromise;
        }
        this.recoverPromise = this.runRecover(ctx).finally(() => {
            this.recoverPromise = null;
        });
        return this.recoverPromise;
    }

    private async runRecover(ctx: NodeLoopContext): Promise<void> {
        this.mode = "recovering";
        this.pushEvent("recover_start", ctx.loopTraceId);
        await this.persistGuard({
            mode: "recovering",
            lastDecision: "recovering",
            silentLastHeartbeatAt: new Date().toISOString(),
            silentRecoveryAttempt: this.silentEvents.filter((event) => event.type === "recover_start").length,
            silentEvents: this.silentEvents,
        });

        const logger = this.createGuardLogger();
        logger.info("Heartbeat restored — recovering business nodes", {
            topic: this.options.logTopic ?? "guard",
        });

        try {
            await this.options.stopBusinessNodes();
        } catch (error) {
            logger.warn("stopBusinessNodes failed before respawn", {
                topic: this.options.logTopic ?? "guard",
                data: { error: getErrorMessage(error) },
            });
        }

        try {
            await this.options.spawnBusinessNodes("guard:silent-recover");
            markWorkerSpawned();
            await this.waitUntilBusinessReady();
        } catch (error) {
            this.pushEvent("recover_fail", getErrorMessage(error));
            this.mode = "silent";
            this.bumpSilentBackoff();
            await this.persistGuard({
                mode: "silent",
                lastDecision: "recover_fail",
                silentBackoffMs: this.getLoopIntervalMs(),
                silentEvents: this.silentEvents,
            });
            logger.warn("Recovery failed — returning to silent", {
                topic: this.options.logTopic ?? "guard",
                data: { error: getErrorMessage(error) },
            });
            try {
                await this.options.stopBusinessNodes();
            } catch {
                // best-effort — leftover children are stopped again on the next recover
            }
            return;
        }

        this.mode = "healthy";
        this.silentBackoffIndex = 0;
        this.pushEvent("recover_ok");
        await this.persistGuard({
            mode: "healthy",
            lastDecision: "recover_ok",
            silentEnteredAt: null,
            silentBackoffMs: 0,
            silentConsecutiveFailures: 0,
            silentEvents: this.silentEvents,
        });
        logger.success("Left silent mode — business nodes ready", {
            topic: this.options.logTopic ?? "guard",
        });
    }

    private async waitUntilBusinessReady(): Promise<void> {
        try {
            await pollUntil({
                timeoutMs: this.businessReadyTimeoutMs,
                intervalMs: 500,
                until: () => this.options.isBusinessReady(),
            });
        } catch {
            throw new Error(`Business nodes not ready within ${this.businessReadyTimeoutMs}ms`);
        }
    }

    private pushEvent(type: string, detail?: string): void {
        this.silentEvents = [...this.silentEvents, { at: new Date().toISOString(), type, detail }].slice(
            -SILENT_EVENT_LIMIT,
        );
    }

    private async persistGuard(patch: Partial<GuardRuntimeSlice>): Promise<void> {
        try {
            await this.options.guardRunner.onGuardPatch(patch);
        } catch {
            // best-effort — disk/runtime state must not take down the guard loop
        }
    }

    private createGuardLogger(): LoggerWithScope {
        return createLogger({ module: "service-guard" });
    }
}

export { ServiceGuardNode };
