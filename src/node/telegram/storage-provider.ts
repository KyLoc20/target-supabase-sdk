import type { CreateUploadAdapterOptions, Parcel, StorageProviderModule, UploadTracker } from "../../browser";
import { isOpaqueChunkUrl } from "../../browser";
import { callTelegramApi } from "./api-client";
import { downloadTelegramChunk } from "./chunk";
import { encodeTelegramChunkUrl, parseTelegramChunkUrl } from "./chunk-locator";
import {
    type ResolvedTelegramStorageOptions,
    resolveTelegramStorageOptions,
    type TelegramMessage,
    type TelegramStorageProviderOptions,
    type TelegramUploadResult,
} from "./types";

export const PROVIDER_TELEGRAM = "telegram";

export interface TelegramChunkDeleteResult {
    deleted: number;
    failed: number;
    skipped: number;
}

export interface TelegramStorageProvider extends StorageProviderModule {
    readonly provider: typeof PROVIDER_TELEGRAM;
    /** Low-level upload for probes/CLIs. */
    uploadChunk(data: ArrayBuffer, filename: string): Promise<TelegramUploadResult>;
    /** Best-effort deleteMessage for rollback / probe cleanup. */
    deleteMessage(messageId: number): Promise<void>;
    /**
     * Best-effort delete Telegram messages for parcel chunks.
     * Chunks without an encoded messageId (legacy bare file_id) are skipped.
     */
    deleteChunkBlobs(parcel: Parcel): Promise<TelegramChunkDeleteResult>;
}

async function uploadChunkToTelegram(
    options: ResolvedTelegramStorageOptions,
    data: ArrayBuffer,
    filename: string,
): Promise<TelegramUploadResult> {
    const sizeMb = (data.byteLength / (1024 * 1024)).toFixed(2);

    const message = await callTelegramApi<TelegramMessage>(
        options,
        "sendDocument",
        () => {
            const form = new FormData();
            form.append("chat_id", options.chatId);
            form.append("document", new Blob([data]), filename);
            return { method: "POST", body: form };
        },
        {
            timeoutMs: options.uploadTimeoutMs,
            retryAttempts: options.uploadRetryAttempts,
            retryBaseMs: options.uploadRetryBaseMs,
        },
    );

    const fileId = message.document?.file_id;
    if (fileId == null || fileId === "") {
        throw new Error(`Telegram sendDocument: missing file_id (chunk ${filename}, ${sizeMb} MB)`);
    }

    return { fileId, messageId: message.message_id };
}

async function deleteTelegramMessage(options: ResolvedTelegramStorageOptions, messageId: number): Promise<void> {
    await callTelegramApi<boolean>(
        options,
        "deleteMessage",
        () => {
            const form = new FormData();
            form.append("chat_id", options.chatId);
            form.append("message_id", String(messageId));
            return { method: "POST", body: form };
        },
        {
            retryAttempts: 3,
            retryBaseMs: 1_000,
        },
    );
}

async function rollbackTelegramUploads(options: ResolvedTelegramStorageOptions, handles: unknown[]): Promise<void> {
    for (const item of handles) {
        const upload = item as TelegramUploadResult;
        if (upload?.messageId == null) {
            continue;
        }
        try {
            await deleteTelegramMessage(options, upload.messageId);
        } catch {
            // Best-effort cleanup
        }
    }
}

function assertTelegramParcel(parcel: Parcel): void {
    const chunks = parcel.details.chunkList;
    if (chunks.length === 0) {
        throw new Error("Parcel has no chunks");
    }

    const nonTelegram = chunks.filter((chunk) => chunk.provider != null && chunk.provider !== PROVIDER_TELEGRAM);
    if (nonTelegram.length > 0) {
        const providers = [...new Set(nonTelegram.map((chunk) => chunk.provider))];
        throw new Error(
            `Parcel is not telegram-only (found providers: ${providers.join(", ")}). ` +
                "Multi-provider restore is not yet supported for this parcel.",
        );
    }
}

/**
 * Build a Telegram {@link StorageProviderModule}. Caller registers it — no side effects.
 *
 * @example
 * ```ts
 * import { createStorageProviderRegistry, createTelegramStorageProvider } from "target-supabase-sdk/node";
 * const registry = createStorageProviderRegistry();
 * registry.register(createTelegramStorageProvider({ botToken, chatId, proxyUrl }));
 * ```
 */
export function createTelegramStorageProvider(input: TelegramStorageProviderOptions): TelegramStorageProvider {
    const options = resolveTelegramStorageOptions(input);

    return {
        provider: PROVIDER_TELEGRAM,
        uploadChunk: (data, filename) => uploadChunkToTelegram(options, data, filename),
        deleteMessage: (messageId) => deleteTelegramMessage(options, messageId),
        async deleteChunkBlobs(parcel) {
            let deleted = 0;
            let failed = 0;
            let skipped = 0;
            for (const chunk of parcel.details.chunkList) {
                if (chunk.provider != null && chunk.provider !== PROVIDER_TELEGRAM) {
                    skipped += 1;
                    continue;
                }
                const { messageId } = parseTelegramChunkUrl(chunk.url);
                if (messageId == null) {
                    skipped += 1;
                    continue;
                }
                try {
                    await deleteTelegramMessage(options, messageId);
                    deleted += 1;
                } catch {
                    failed += 1;
                }
            }
            return { deleted, failed, skipped };
        },
        createUploadAdapter(adapterOptions?: CreateUploadAdapterOptions) {
            const tracker = adapterOptions?.tracker as UploadTracker<TelegramUploadResult> | undefined;
            return {
                provider: PROVIDER_TELEGRAM,
                async upload(data, pathOrKey) {
                    const result = await uploadChunkToTelegram(options, data, pathOrKey);
                    tracker?.push(result);
                    // Persist messageId so later deleteParcel can call deleteMessage.
                    return { url: encodeTelegramChunkUrl(result.messageId, result.fileId) };
                },
            };
        },
        resolveChunk: (locator) => {
            const { fileId } = parseTelegramChunkUrl(locator);
            return downloadTelegramChunk(options, fileId);
        },
        matchesOpaqueUrl: isOpaqueChunkUrl,
        async probe() {
            try {
                const me = await callTelegramApi<{ username?: string }>(options, "getMe", { method: "GET" });
                return { ok: true as const, detail: { username: me.username ?? "unknown" } };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { ok: false as const, error: message };
            }
        },
        rollbackUpload: (handles) => rollbackTelegramUploads(options, handles),
        assertParcelRestorable: assertTelegramParcel,
    };
}
