import { access, constants, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isLogEntry } from "../core/log-batch";
import { computeLogBatchIdempotencyKey } from "../upload/batch-id";
import { buildLogListDraft, postLogBatch } from "../upload/flush";
import { spoolLogger } from "../upload/logger";
import { type DEFAULT_LOG_SPOOL_CONFIG, resolveLogSpoolConfig } from "./config";
import { parseLogSpoolBatchFilename } from "./file";
import type { LogSpoolBatchFile, LogSpoolProcessRole } from "./interface";
import { logSpoolProcessDir, resolveLogSpoolRoot } from "./paths";
import { resolveAllLogSpoolProcessRoles } from "./process-roles";

const UPLOAD_LANE = "slow";

/** Per serviceId — guard collect-log tick runs GC at most once per `gc.intervalMs`. */
const lastGcAtMsByServiceId = new Map<string, number>();

export interface RunCollectLogTickInput {
    serviceId: string;
    serviceValue: string;
    spoolRoot?: string;
    config?: Partial<typeof DEFAULT_LOG_SPOOL_CONFIG>;
    nowMs?: number;
}

export interface RunCollectLogTickResult {
    uploaded: number;
    skipped: number;
    failed: number;
    gcTmpRemoved: number;
    gcSyncedRemoved: number;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function readBatchTmpFile(tmpPath: string): Promise<LogSpoolBatchFile | null> {
    try {
        const raw = await readFile(tmpPath, "utf8");
        const parsed = JSON.parse(raw) as LogSpoolBatchFile;
        if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
            return null;
        }
        const entries = parsed.entries.filter(isLogEntry);
        if (entries.length === 0) {
            return null;
        }
        return { entries, meta: parsed.meta };
    } catch {
        return null;
    }
}

function processMetaKey(serviceId: string, processRole: LogSpoolProcessRole): string {
    return `${serviceId}:${processRole}`;
}

async function uploadTmpBatch(input: {
    serviceId: string;
    serviceValue: string;
    processRole: LogSpoolProcessRole;
    tmpPath: string;
    fileName: string;
    spoolRoot: string;
    postTimeoutMs: number;
}): Promise<"uploaded" | "skipped" | "failed"> {
    const parsed = parseLogSpoolBatchFilename(input.fileName);
    if (parsed == null) {
        spoolLogger.warn("collect-log skipped — invalid tmp filename", { fileName: input.fileName });
        return "failed";
    }

    const jsonFileName = input.fileName.replace(/\.tmp$/, ".json");
    const jsonPath = join(logSpoolProcessDir(input.spoolRoot, input.serviceId, input.processRole), jsonFileName);

    if (await pathExists(jsonPath)) {
        try {
            await unlink(input.tmpPath);
            spoolLogger.info("collect-log removed orphan tmp (json exists)", {
                tmpPath: input.tmpPath,
                jsonPath,
            });
        } catch {
            // best-effort
        }
        return "skipped";
    }

    const batch = await readBatchTmpFile(input.tmpPath);
    if (batch == null) {
        spoolLogger.warn("collect-log skipped — tmp failed validation", {
            tmpPath: input.tmpPath,
            fileName: input.fileName,
        });
        try {
            await unlink(input.tmpPath);
            spoolLogger.info("collect-log removed invalid tmp", { tmpPath: input.tmpPath });
        } catch {
            // best-effort
        }
        return "failed";
    }

    const processKey = processMetaKey(input.serviceId, input.processRole);
    // TODO: `lane` is legacy transport metadata — scheduled for removal; fixed to "slow" for downstream decode compatibility.
    const idempotencyKey = computeLogBatchIdempotencyKey({
        service: input.serviceValue,
        process: processKey,
        lane: UPLOAD_LANE,
        entries: batch.entries,
    });

    const draft = buildLogListDraft({
        service: input.serviceValue,
        process: processKey,
        lane: UPLOAD_LANE,
        idempotencyKey,
        entries: batch.entries,
    });

    try {
        await postLogBatch(draft, input.postTimeoutMs);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spoolLogger.error("collect-log upload failed", {
            fileName: input.fileName,
            processRole: input.processRole,
            error: message,
        });
        return "failed";
    }

    try {
        await rename(input.tmpPath, jsonPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spoolLogger.error("collect-log rename tmp→json failed after upload", {
            tmpPath: input.tmpPath,
            jsonPath,
            error: message,
        });
        return "failed";
    }

    spoolLogger.info("collect-log uploaded batch", {
        processRole: input.processRole,
        fileName: jsonFileName,
        entryCount: batch.entries.length,
        idempotencyKey,
    });

    return "uploaded";
}

async function gcTmpFiles(input: {
    spoolRoot: string;
    serviceId: string;
    processRole: LogSpoolProcessRole;
    tmpRetentionMs: number;
    nowMs: number;
}): Promise<number> {
    const processDir = logSpoolProcessDir(input.spoolRoot, input.serviceId, input.processRole);
    let removed = 0;

    try {
        const names = await readdir(processDir);
        for (const name of names) {
            if (!name.endsWith(".tmp")) {
                continue;
            }
            const parsed = parseLogSpoolBatchFilename(name);
            if (parsed == null) {
                continue;
            }
            if (input.nowMs - parsed.timestampMs <= input.tmpRetentionMs) {
                continue;
            }
            try {
                await unlink(join(processDir, name));
                removed += 1;
                spoolLogger.info("collect-log gc removed stale tmp", {
                    fileName: name,
                    processRole: input.processRole,
                });
            } catch {
                // best-effort
            }
        }
    } catch {
        // directory may not exist yet
    }

    return removed;
}

async function gcSyncedJsonFiles(input: {
    spoolRoot: string;
    serviceId: string;
    syncedRetentionMs: number;
    nowMs: number;
}): Promise<number> {
    let removed = 0;

    for (const processRole of resolveAllLogSpoolProcessRoles()) {
        const processDir = logSpoolProcessDir(input.spoolRoot, input.serviceId, processRole);
        let names: string[] = [];
        try {
            names = await readdir(processDir);
        } catch {
            continue;
        }

        for (const name of names) {
            if (!name.endsWith(".json")) {
                continue;
            }
            if (parseLogSpoolBatchFilename(name) == null) {
                continue;
            }

            const jsonPath = join(processDir, name);
            try {
                const fileStat = await stat(jsonPath);
                if (input.nowMs - fileStat.mtimeMs <= input.syncedRetentionMs) {
                    continue;
                }
                await unlink(jsonPath);
                removed += 1;
                spoolLogger.info("collect-log gc removed synced json", {
                    fileName: name,
                    processRole,
                });
            } catch {
                // best-effort
            }
        }
    }

    return removed;
}

function shouldRunGc(serviceId: string, nowMs: number, intervalMs: number): boolean {
    const lastAt = lastGcAtMsByServiceId.get(serviceId) ?? 0;
    if (nowMs - lastAt < intervalMs) {
        return false;
    }
    lastGcAtMsByServiceId.set(serviceId, nowMs);
    return true;
}

/**
 * Guard-only: upload pending `.tmp` batches, rename to `.json`, then periodic GC.
 * Upload completion is implied by `.json` presence; no sync-state file.
 */
export async function runCollectLogTick(input: RunCollectLogTickInput): Promise<RunCollectLogTickResult> {
    const config = resolveLogSpoolConfig(input.config);
    const spoolRoot = input.spoolRoot ?? resolveLogSpoolRoot();
    const nowMs = input.nowMs ?? Date.now();

    const result: RunCollectLogTickResult = {
        uploaded: 0,
        skipped: 0,
        failed: 0,
        gcTmpRemoved: 0,
        gcSyncedRemoved: 0,
    };

    for (const processRole of resolveAllLogSpoolProcessRoles()) {
        const processDir = logSpoolProcessDir(spoolRoot, input.serviceId, processRole);
        let names: string[] = [];
        try {
            names = await readdir(processDir);
        } catch {
            continue;
        }

        for (const name of names) {
            if (!name.endsWith(".tmp")) {
                continue;
            }
            const status = await uploadTmpBatch({
                serviceId: input.serviceId,
                serviceValue: input.serviceValue,
                processRole,
                tmpPath: join(processDir, name),
                fileName: name,
                spoolRoot,
                postTimeoutMs: config.writer.postTimeoutMs,
            });
            if (status === "uploaded") {
                result.uploaded += 1;
            } else if (status === "skipped") {
                result.skipped += 1;
            } else {
                result.failed += 1;
            }
        }
    }

    if (shouldRunGc(input.serviceId, nowMs, config.gc.intervalMs)) {
        for (const processRole of resolveAllLogSpoolProcessRoles()) {
            result.gcTmpRemoved += await gcTmpFiles({
                spoolRoot,
                serviceId: input.serviceId,
                processRole,
                tmpRetentionMs: config.gc.tmpRetentionMs,
                nowMs,
            });
        }

        result.gcSyncedRemoved = await gcSyncedJsonFiles({
            spoolRoot,
            serviceId: input.serviceId,
            syncedRetentionMs: config.gc.syncedRetentionMs,
            nowMs,
        });
    }

    if (result.uploaded > 0 || result.failed > 0) {
        spoolLogger.info("collect-log tick complete", { ...result, serviceId: input.serviceId });
    }

    return result;
}
