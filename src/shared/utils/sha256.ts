function getCrypto(): Crypto {
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
        return globalThis.crypto;
    }
    throw new Error("sha256Hex: crypto.subtle not available");
}

/** SHA-256 digest as lowercase hex (browser + Node Web Crypto). */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
    const crypto = getCrypto();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}
