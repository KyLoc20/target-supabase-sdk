/**
 * Telegram chunk URL encoding: `${messageId}|${fileId}`.
 * Legacy parcels store bare `file_id` (no messageId → cannot deleteMessage).
 */

const SEPARATOR = "|";

export function encodeTelegramChunkUrl(messageId: number, fileId: string): string {
    return `${messageId}${SEPARATOR}${fileId}`;
}

export function parseTelegramChunkUrl(locator: string): { messageId: number | null; fileId: string } {
    const idx = locator.indexOf(SEPARATOR);
    if (idx <= 0) {
        return { messageId: null, fileId: locator };
    }
    const mid = Number(locator.slice(0, idx));
    const fileId = locator.slice(idx + 1);
    if (!Number.isInteger(mid) || mid <= 0 || fileId === "") {
        return { messageId: null, fileId: locator };
    }
    return { messageId: mid, fileId };
}
