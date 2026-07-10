import { isCreateTargetAlreadyExistsError } from "../../core.api";
import { postLogListCreate } from "../../list/list.api";
import { CategoryList } from "../../list/list.interface";
import type { LogEntry } from "./log-manager";
import { LOG_PERSIST_LOADER_KEY } from "./log-persist.config";
import type { BuildLogListDraftInput, LogListDraft } from "./log-persist.interface";
import { persistLogger } from "./log-persist-logger";

export function estimateEntriesBytes(entries: LogEntry[]): number {
    if (entries.length === 0) {
        return 0;
    }
    try {
        return Buffer.byteLength(JSON.stringify(entries), "utf8");
    } catch {
        return entries.length * 512;
    }
}

export function buildLogListDraft(input: BuildLogListDraftInput): LogListDraft {
    const { service, process, lane, idempotencyKey, entries } = input;
    const first = entries[0];
    const last = entries[entries.length - 1];

    return {
        name: `${service}:${process}`,
        value: idempotencyKey,
        category: CategoryList.LIST,
        tagList: ["log", lane, service],
        details: {
            manifestVersion: 1,
            loaderKey: LOG_PERSIST_LOADER_KEY,
            meta: JSON.stringify({
                service,
                process,
                pid: globalThis.process.pid,
                lane,
                count: entries.length,
                from: first?.timestamp ?? null,
                to: last?.timestamp ?? null,
                flushedAt: Date.now(),
                idempotencyKey,
            }),
            preview: first?.message ?? "",
            items: entries,
        },
    };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer != null) {
            clearTimeout(timer);
        }
    }
}

export async function postLogBatch(draft: LogListDraft, postTimeoutMs: number): Promise<void> {
    try {
        const result = await withTimeout(
            postLogListCreate({
                name: draft.name,
                value: draft.value,
                category: draft.category,
                details: draft.details,
            }),
            postTimeoutMs,
            "postLogListCreate",
        );

        if (!result.success) {
            const message = result.error?.message ?? "postLogListCreate failed";
            persistLogger.error("post log batch failed", {
                idempotencyKey: draft.value,
                name: draft.name,
                error: message,
            });
            throw new Error(message);
        }
    } catch (error) {
        if (isCreateTargetAlreadyExistsError(error)) {
            persistLogger.error("post log batch idempotent duplicate — treating as success", {
                idempotencyKey: draft.value,
                name: draft.name,
            });
            return;
        }
        throw error;
    }
}

/** Take a prefix of entries that fits within maxBytes. */
export function takeEntriesWithinBytes(entries: LogEntry[], maxBytes: number): LogEntry[] {
    if (entries.length === 0) {
        return [];
    }

    const taken: LogEntry[] = [];
    for (const entry of entries) {
        const candidate = [...taken, entry];
        if (taken.length > 0 && estimateEntriesBytes(candidate) > maxBytes) {
            break;
        }
        taken.push(entry);
    }

    const result = taken.length > 0 ? taken : [entries[0]];
    if (result.length < entries.length) {
        persistLogger.warn("trimmed batch to maxBytes", {
            requested: entries.length,
            taken: result.length,
            maxBytes,
            takenBytes: estimateEntriesBytes(result),
        });
    }

    return result;
}
