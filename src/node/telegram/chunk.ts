import { callTelegramApi, telegramDownloadBinary, telegramFileDownloadUrl } from "./api-client";
import type { ResolvedTelegramStorageOptions, TelegramFile } from "./types";

/** Download chunk bytes by Telegram `file_id` stored in Chunk.url. */
export async function downloadTelegramChunk(
    options: ResolvedTelegramStorageOptions,
    fileId: string,
): Promise<ArrayBuffer> {
    const file = await callTelegramApi<TelegramFile>(
        options,
        `getFile?file_id=${encodeURIComponent(fileId)}`,
        { method: "GET" },
        {
            retryAttempts: options.uploadRetryAttempts,
            retryBaseMs: options.uploadRetryBaseMs,
        },
    );

    if (file.file_path == null || file.file_path === "") {
        throw new Error(`Telegram getFile: missing file_path for file_id ${fileId}`);
    }

    return telegramDownloadBinary(
        options,
        telegramFileDownloadUrl(options, file.file_path),
        `download:${fileId.slice(0, 12)}…`,
        {
            timeoutMs: options.uploadTimeoutMs,
            retryAttempts: options.uploadRetryAttempts,
            retryBaseMs: options.uploadRetryBaseMs,
        },
    );
}
