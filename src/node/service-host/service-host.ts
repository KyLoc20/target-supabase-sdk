import { ServiceRegistryError } from "../../service/registry.service";
import type { ServiceRegistrySession } from "../../service/registry-lifecycle";
import type { Service } from "../../service/service.interface";
import { createLogger, type LoggerWithScope } from "../../shared/log";
import { LOG_SPOOL_SERVICE_ID_ENV } from "../../shared/log/spool/config";
import { ensureLogSpoolFromEnv } from "../../shared/log/spool/enable";
import { logSpoolEnabledFromEnv } from "../../shared/log/upload/env";
import type { ManagedChildProcesses } from "../process/managed-child-processes";
import { claimRegistrySlotOrExit } from "./claim-registry-slot";

export interface ServiceHostClosable {
    close: () => Promise<void>;
}

export interface ServiceHostContext {
    service: Service;
    session: ServiceRegistrySession;
    /** Registry instance id — same as `service.id`; children inherit via spawn env injection. */
    serviceId: string;
}

export interface ServiceHostOptions {
    serviceValue: string;
    logger?: LoggerWithScope;
    logTopic?: string;
    childProcesses?: ManagedChildProcesses;
    /** Labels that trigger host shutdown when the child exits unexpectedly. */
    criticalSupervisors?: readonly string[];

    prepare?: () => Promise<void>;
    createInstance: () => Promise<Service | { service: Service; baseUrl?: string }>;
    onRegistryClaimed?: (ctx: ServiceHostContext) => Promise<void>;
    startSupervisors?: (ctx: ServiceHostContext) => void | Promise<void>;
    waitUntilReady?: () => Promise<void>;
    startServer?: () => Promise<ServiceHostClosable>;
    /** When true (default), enable file log spool for main after registry claim. */
    enableLogSpoolAfterClaim?: boolean;
    /** Stop child processes and other local resources (not registry release). */
    onShutdown?: (signal: string) => Promise<void>;
}

const DEFAULT_CRITICAL_SUPERVISORS = ["guard", "supervisor"] as const;

export interface ServiceHost {
    run: () => Promise<void>;
    requestShutdown: (signal: string, exitCode?: number) => void;
}

function unwrapService(created: Service | { service: Service; baseUrl?: string }): Service {
    return typeof created === "object" && created != null && "service" in created ? created.service : created;
}

export function createServiceHost(options: ServiceHostOptions): ServiceHost {
    const logger = options.logger ?? createLogger({ module: "service-host" });
    const logTopic = options.logTopic ?? "startup";
    const criticalSupervisors = options.criticalSupervisors ?? DEFAULT_CRITICAL_SUPERVISORS;

    let session: ServiceRegistrySession | null = null;
    let httpServer: ServiceHostClosable | null = null;
    let shuttingDown = false;

    async function shutdown(signal: string, exitCode = 0): Promise<void> {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        logger.info("shutting down", { topic: logTopic, data: { signal, exitCode } });

        if (httpServer != null) {
            await httpServer.close().catch(() => undefined);
            httpServer = null;
        }

        if (options.onShutdown != null) {
            await options.onShutdown(signal).catch(() => undefined);
        }

        if (session != null) {
            await session.release();
            session = null;
        }

        process.exit(exitCode);
    }

    function requestShutdown(signal: string, exitCode = 0): void {
        void shutdown(signal, exitCode);
    }

    function installProcessHandlers(): void {
        process.on("SIGINT", () => void shutdown("SIGINT"));
        process.on("SIGTERM", () => void shutdown("SIGTERM"));

        options.childProcesses?.setCriticalExitHandler({
            labels: criticalSupervisors,
            onCriticalExit: (label, code, signal) => {
                if (shuttingDown) {
                    return;
                }
                logger.critical("Critical supervisor exited — shutting down service", {
                    topic: logTopic,
                    data: { label, code, signal },
                });
                void shutdown("supervisor-exit", 1);
            },
        });
    }

    async function run(): Promise<void> {
        installProcessHandlers();

        if (options.prepare != null) {
            await options.prepare();
        }

        session = await claimRegistrySlotOrExit({
            serviceValue: options.serviceValue,
            createInstance: async () => unwrapService(await options.createInstance()),
            logger,
            logTopic,
        });

        const hostCtx: ServiceHostContext = { service: session.service, session, serviceId: session.service.id };

        if (options.onRegistryClaimed != null) {
            await options.onRegistryClaimed(hostCtx);
        }

        const enableSpool = options.enableLogSpoolAfterClaim ?? true;
        if (enableSpool && logSpoolEnabledFromEnv()) {
            process.env[LOG_SPOOL_SERVICE_ID_ENV] = session.service.id;
            await ensureLogSpoolFromEnv({
                serviceId: session.service.id,
                serviceValue: options.serviceValue,
                processRole: "main",
            });
        }

        if (options.startSupervisors != null) {
            await options.startSupervisors(hostCtx);
        }

        if (options.waitUntilReady != null) {
            await options.waitUntilReady();
        }

        if (options.startServer != null) {
            httpServer = await options.startServer();
        }
    }

    async function runWithFatalHandling(): Promise<void> {
        try {
            await run();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const code = error instanceof ServiceRegistryError ? error.code : undefined;
            logger.error("fatal", { topic: logTopic, data: { message, code } });

            if (httpServer != null) {
                await httpServer.close().catch(() => undefined);
                httpServer = null;
            }

            if (options.onShutdown != null) {
                await options.onShutdown("fatal").catch(() => undefined);
            }

            if (session != null) {
                await session.release().catch(() => undefined);
                session = null;
            }

            process.exit(1);
        }
    }

    return { run: runWithFatalHandling, requestShutdown };
}
