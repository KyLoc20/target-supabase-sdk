import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LogEntry } from "../core/log-manager";
import { estimateEntriesBytes, takeEntriesWithinBytes } from "../upload/flush";
import { registerLogPersistOffer } from "../upload/hook";
import { isLogPersistInternalTopic, spoolLogger } from "../upload/logger";
import { DEFAULT_LOG_SPOOL_CONFIG, resolveLogSpoolConfig } from "./config";
import { buildLogSpoolBatchBaseName, computeLogSpoolShortHash } from "./file";
import type { EnableLogSpoolOptions, LogSpoolBatchFile, LogSpoolProcessRole, LogSpoolWriterStats } from "./interface";
import { logSpoolProcessDir, resolveLogSpoolRoot } from "./paths";

class LogSpoolWriter {
    private static instance: LogSpoolWriter | null = null;

    private enabled = false;
    private buffer: LogEntry[] = [];
    private flushInProgress = false;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private ageTimer: ReturnType<typeof setTimeout> | null = null;
    private serviceId: string | null = null;
    private processRole: LogSpoolProcessRole | null = null;
    private serviceValue: string | null = null;
    private spoolRoot: string | null = null;
    private config = DEFAULT_LOG_SPOOL_CONFIG.writer;

    static getInstance(): LogSpoolWriter {
        LogSpoolWriter.instance ??= new LogSpoolWriter();
        return LogSpoolWriter.instance;
    }

    async enable(options: EnableLogSpoolOptions): Promise<void> {
        if (this.enabled) {
            spoolLogger.warn("log spool writer already enabled", {
                serviceId: this.serviceId,
                processRole: this.processRole,
            });
            return;
        }

        this.serviceId = options.serviceId;
        this.processRole = options.processRole;
        this.serviceValue = options.serviceValue;
        this.spoolRoot = options.spoolRoot ?? resolveLogSpoolRoot();
        this.config = resolveLogSpoolConfig(options.config).writer;
        this.enabled = true;

        registerLogPersistOffer((entry) => this.offer(entry));

        spoolLogger.info("log spool writer enabled", {
            serviceId: options.serviceId,
            processRole: options.processRole,
            serviceValue: options.serviceValue,
            spoolRoot: this.spoolRoot,
            config: this.config,
        });
    }

    async shutdown(): Promise<void> {
        this.cancelDebounce();
        this.cancelAgeFlush();
        registerLogPersistOffer(null);
        this.enabled = false;

        while (this.buffer.length > 0) {
            await this.flushChunk({ reason: "shutdown" });
        }

        spoolLogger.info("log spool writer shutdown complete", {
            serviceId: this.serviceId,
            processRole: this.processRole,
        });
    }

    getStats(): LogSpoolWriterStats {
        return {
            enabled: this.enabled,
            bufferedEntries: this.buffer.length,
            bufferedBytes: estimateEntriesBytes(this.buffer),
            flushInProgress: this.flushInProgress,
            debouncePending: this.debounceTimer != null,
            ageFlushPending: this.ageTimer != null,
            serviceId: this.serviceId,
            processRole: this.processRole,
        };
    }

    offer(entry: LogEntry): void {
        if (isLogPersistInternalTopic(entry.topic)) {
            return;
        }

        if (!this.enabled) {
            return;
        }

        if (this.buffer.length === 0) {
            this.scheduleAgeFlush();
        }

        this.buffer.push(entry);

        if (this.shouldScheduleDebouncedFlush()) {
            this.scheduleDebouncedFlush();
        }
    }

    private shouldScheduleDebouncedFlush(): boolean {
        return (
            this.buffer.length >= this.config.maxEntries || estimateEntriesBytes(this.buffer) >= this.config.maxBytes
        );
    }

    private scheduleDebouncedFlush(): void {
        if (this.debounceTimer != null) {
            return;
        }

        spoolLogger.debug("log spool flush debounce scheduled", {
            debounceMs: this.config.flushDebounceMs,
            bufferedEntries: this.buffer.length,
        });

        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.flushChunk({ reason: "debounce" });
        }, this.config.flushDebounceMs);
        this.debounceTimer.unref?.();
    }

    private scheduleAgeFlush(): void {
        if (this.ageTimer != null) {
            return;
        }

        spoolLogger.debug("log spool age flush scheduled", {
            maxAgeMs: this.config.maxAgeMs,
        });

        this.ageTimer = setTimeout(() => {
            this.ageTimer = null;
            void this.flushChunk({ reason: "maxAge" });
        }, this.config.maxAgeMs);
        this.ageTimer.unref?.();
    }

    private cancelDebounce(): void {
        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private cancelAgeFlush(): void {
        if (this.ageTimer != null) {
            clearTimeout(this.ageTimer);
            this.ageTimer = null;
        }
    }

    private async flushChunk(input: { reason: string }): Promise<void> {
        if (this.flushInProgress || this.buffer.length === 0) {
            return;
        }
        if (this.serviceId == null || this.processRole == null || this.serviceValue == null || this.spoolRoot == null) {
            return;
        }

        this.cancelDebounce();
        this.cancelAgeFlush();
        this.flushInProgress = true;
        try {
            const byCount = this.buffer.slice(0, this.config.maxEntries);
            const entries = takeEntriesWithinBytes(byCount, this.config.maxBytes);
            this.buffer = this.buffer.slice(entries.length);

            if (entries.length === 0) {
                if (this.buffer.length > 0) {
                    this.scheduleAgeFlush();
                } else {
                    this.cancelAgeFlush();
                }
                return;
            }

            const batchFile = await this.writeBatchTmp({
                entries,
                serviceId: this.serviceId,
                processRole: this.processRole,
                serviceValue: this.serviceValue,
                spoolRoot: this.spoolRoot,
            });

            spoolLogger.info("log spool flushed to tmp", {
                reason: input.reason,
                fileName: batchFile.fileName,
                entryCount: entries.length,
                remainingBuffered: this.buffer.length,
            });

            if (this.buffer.length > 0) {
                this.scheduleAgeFlush();
                if (this.shouldScheduleDebouncedFlush()) {
                    this.scheduleDebouncedFlush();
                }
            } else {
                this.cancelAgeFlush();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            spoolLogger.error("log spool flush failed", { reason: input.reason, error: message });
            if (this.buffer.length > 0) {
                this.scheduleAgeFlush();
            }
        } finally {
            this.flushInProgress = false;
        }
    }

    private async writeBatchTmp(input: {
        entries: LogEntry[];
        serviceId: string;
        processRole: LogSpoolProcessRole;
        serviceValue: string;
        spoolRoot: string;
    }): Promise<{ fileName: string; tmpPath: string }> {
        const first = input.entries[0];
        const shortHash = computeLogSpoolShortHash({
            serviceValue: input.serviceValue,
            serviceId: input.serviceId,
            processRole: input.processRole,
            entries: input.entries,
        });
        const baseName = buildLogSpoolBatchBaseName({
            processRole: input.processRole,
            firstEntryTimestamp: first.timestamp,
            shortHash,
        });
        const fileName = `${baseName}.tmp`;
        const processDir = logSpoolProcessDir(input.spoolRoot, input.serviceId, input.processRole);
        await mkdir(processDir, { recursive: true });

        const tmpPath = join(processDir, fileName);
        const partPath = `${tmpPath}.part`;
        const payload: LogSpoolBatchFile = {
            entries: input.entries,
            meta: {
                serviceId: input.serviceId,
                processRole: input.processRole,
                serviceValue: input.serviceValue,
            },
        };
        const content = `${JSON.stringify(payload)}\n`;

        await writeFile(partPath, content, "utf8");
        await rename(partPath, tmpPath);

        return { fileName, tmpPath };
    }
}

export { LogSpoolWriter };

export async function enableLogSpoolWriter(options: EnableLogSpoolOptions): Promise<void> {
    await LogSpoolWriter.getInstance().enable(options);
}

export async function shutdownLogSpoolWriter(): Promise<void> {
    await LogSpoolWriter.getInstance().shutdown();
}

export function getLogSpoolWriterStats(): LogSpoolWriterStats {
    return LogSpoolWriter.getInstance().getStats();
}
