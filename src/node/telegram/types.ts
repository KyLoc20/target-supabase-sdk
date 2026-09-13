export interface TelegramApiResponse<T> {
    ok: boolean;
    description?: string;
    result?: T;
}

export interface TelegramDocument {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
}

export interface TelegramMessage {
    message_id: number;
    document?: TelegramDocument;
}

export interface TelegramFile {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
}

export interface TelegramUploadResult {
    fileId: string;
    messageId: number;
}

/** Injected config for Telegram Bot API storage — do not read process.env inside SDK. */
export interface TelegramStorageProviderOptions {
    botToken: string;
    chatId: string;
    /** Default `https://api.telegram.org`. */
    apiBaseUrl?: string;
    /** HTTP(S) proxy for Telegram only (e.g. Clash). Supabase stays direct. */
    proxyUrl?: string;
    /** Default 30s — getMe / getFile. */
    fetchTimeoutMs?: number;
    /** Default 120s — sendDocument / file download. */
    uploadTimeoutMs?: number;
    /** Default 3. */
    uploadRetryAttempts?: number;
    /** Default 2000 — backoff base for attempt N: base * 2^(N-1). */
    uploadRetryBaseMs?: number;
}

export interface ResolvedTelegramStorageOptions {
    botToken: string;
    chatId: string;
    apiBaseUrl: string;
    proxyUrl?: string;
    fetchTimeoutMs: number;
    uploadTimeoutMs: number;
    uploadRetryAttempts: number;
    uploadRetryBaseMs: number;
}

export function resolveTelegramStorageOptions(options: TelegramStorageProviderOptions): ResolvedTelegramStorageOptions {
    const botToken = options.botToken.trim();
    const chatId = options.chatId.trim();
    if (botToken === "") {
        throw new Error("TelegramStorageProviderOptions.botToken is required");
    }
    if (chatId === "") {
        throw new Error("TelegramStorageProviderOptions.chatId is required");
    }

    const apiBaseUrl = (options.apiBaseUrl?.trim() || "https://api.telegram.org").replace(/\/$/, "");
    const proxyUrl = options.proxyUrl?.trim() || undefined;

    return {
        botToken,
        chatId,
        apiBaseUrl,
        proxyUrl: proxyUrl !== "" ? proxyUrl : undefined,
        fetchTimeoutMs: options.fetchTimeoutMs ?? 30_000,
        uploadTimeoutMs: options.uploadTimeoutMs ?? 120_000,
        uploadRetryAttempts: options.uploadRetryAttempts ?? 3,
        uploadRetryBaseMs: options.uploadRetryBaseMs ?? 2_000,
    };
}
