import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Parcel } from "../src/parcel/parcel.interface.js";
import type { StorageAdapter } from "../src/parcel/parcel-manager.js";

export const CHUNK_SUFFIX = ".parcel-chunk-";
export const KEY_SUFFIX = ".parcel.key.jwk";
export function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next != null && !next.startsWith("--")) {
            out[key] = next;
            i++;
        } else {
            out[key] = "true";
        }
    }
    return out;
}


export function keyPathForSourceFile(sourcePath: string): string {
    return `${resolve(sourcePath)}${KEY_SUFFIX}`;
}

export function chunkFilenameForSource(sourcePath: string, index: number): string {
    return `${resolve(sourcePath)}${CHUNK_SUFFIX}${String(index).padStart(3, "0")}.bin`;
}

/** One logical "platform" — all chunks still land in the source file's directory */
export function createLocalDirStorageAdapter(sourcePath: string): StorageAdapter {
    const outputDir = dirname(resolve(sourcePath));
    const base = resolve(sourcePath);

    return {
        provider: "local-dir",
        async upload(data, _pathOrKey) {
            const match = /chunk-(\d+)-/.exec(_pathOrKey);
            const index = match != null ? Number(match[1]) : 0;
            const chunkPath = chunkFilenameForSource(base, index);
            await mkdir(outputDir, { recursive: true });
            await writeFile(chunkPath, Buffer.from(data));
            return { url: chunkPath };
        },
    };
}


export async function exportKeyToJwk(key: CryptoKey, keyPath: string): Promise<void> {
    const jwk = await crypto.subtle.exportKey("jwk", key);
    await writeFile(keyPath, `${JSON.stringify(jwk, null, 2)}\n`, "utf8");
}

export async function importKeyFromJwk(keyPath: string): Promise<CryptoKey> {
    const jwk = JSON.parse(await readFile(keyPath, "utf8"));
    return crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

/**
 * ParcelManager.reassemble uses fetch(); Node does not fetch bare paths.
 * Resolve chunk paths relative to `baseDir` (absolute chunk urls pass through).
 */
export function installLocalChunkFetch(baseDir: string): () => void {
    const resolvedBase = resolve(baseDir);
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;

        if (url.startsWith("http://") || url.startsWith("https://")) {
            return originalFetch(input, init);
        }

        const filePath = resolve(resolvedBase, url);
        const body = await readFile(filePath);
        return new Response(body);
    }) as typeof fetch;

    return () => {
        globalThis.fetch = originalFetch;
    };
}

export function chunkStorageBaseDir(parcel: Parcel): string {
    const firstUrl = parcel.details.chunkList[0]?.url;
    if (firstUrl == null || firstUrl === "") {
        throw new Error("Parcel has no chunk urls");
    }
    return dirname(resolve(firstUrl));
}


export const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
