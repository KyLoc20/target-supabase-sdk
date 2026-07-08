import type { ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { LoggerWithScope } from "../../shared/log";
import { isChildProcessRunning, spawnTsxChild } from "./process-spawn";

export interface ManagedChildProcessesOptions {
    projectRoot: string;
    preloadModules?: readonly string[];
    /** SIGTERM -> wait -> SIGKILL delay (default 5000 ms). */
    graceMs?: number;
    logger?: Pick<LoggerWithScope, "info" | "warn" | "error">;
}

export interface SpawnChildResult {
    child: ChildProcess;
    /** false when an equivalent label was already running. */
    created: boolean;
}

export interface StopAllChildrenOptions {
    /** PIDs to SIGTERM when not tracked by this registry (cross-process cleanup). */
    extraPids?: readonly number[];
}

/**
 * Process-local registry for tsx child processes (supervisor, worker, etc.).
 * Each OS process has its own instance - do not expect cross-process PID tracking.
 */
export class ManagedChildProcesses {
    private readonly projectRoot: string;
    private readonly preloadModules: readonly string[];
    private readonly graceMs: number;
    private readonly logger?: Pick<LoggerWithScope, "info" | "warn" | "error">;
    private readonly byLabel = new Map<string, ChildProcess>();

    constructor(options: ManagedChildProcessesOptions) {
        this.projectRoot = options.projectRoot;
        this.preloadModules = options.preloadModules ?? [];
        this.graceMs = options.graceMs ?? 5_000;
        this.logger = options.logger;
    }

    get(label: string): ChildProcess | null {
        return this.byLabel.get(label) ?? null;
    }

    getRunning(label: string): ChildProcess | null {
        const child = this.byLabel.get(label);
        return isChildProcessRunning(child) ? child : null;
    }

    runningLabels(): string[] {
        return [...this.byLabel.entries()]
            .filter((entry): entry is [string, ChildProcess] => isChildProcessRunning(entry[1]))
            .map(([label]) => label);
    }

    spawn(label: string, entryScript: string): SpawnChildResult {
        const existing = this.getRunning(label);
        if (existing != null) {
            return { child: existing, created: false };
        }

        const child = spawnTsxChild({
            projectRoot: this.projectRoot,
            entryScript,
            preloadModules: this.preloadModules,
        });

        child.on("exit", (code, signal) => {
            this.logger?.info("child exited", { topic: "process", data: { label, code, signal } });
            const current = this.byLabel.get(label);
            if (current === child) {
                this.byLabel.delete(label);
            }
        });

        this.byLabel.set(label, child);

        this.logger?.info("child started", {
            topic: "process",
            data: {
                label,
                pid: child.pid,
                script: resolve(this.projectRoot, entryScript),
            },
        });

        return { child, created: true };
    }

    async stopAll(options?: StopAllChildrenOptions): Promise<void> {
        const tracked = [...this.byLabel.values()].filter((child) => isChildProcessRunning(child));

        await Promise.all(tracked.map((child) => this.stopChild(child)));

        const extraPids = options?.extraPids ?? [];
        for (const pid of extraPids) {
            if (pid == null || tracked.some((child) => child.pid === pid)) {
                continue;
            }
            try {
                process.kill(pid, "SIGTERM");
            } catch {
                // already exited
            }
        }
    }

    private stopChild(child: ChildProcess): Promise<void> {
        return new Promise((resolvePromise) => {
            child.once("exit", () => resolvePromise());
            child.kill("SIGTERM");
            setTimeout(() => {
                if (isChildProcessRunning(child)) {
                    child.kill("SIGKILL");
                }
            }, this.graceMs);
        });
    }
}
