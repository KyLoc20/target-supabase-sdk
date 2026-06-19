/** RFC 4122 v4 UUID for trace / correlation ids. Requires Node 18+ (`engines` in package.json). */
export function generateUniqueId(): string {
    return globalThis.crypto.randomUUID();
}
