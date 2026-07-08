import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256Hex } from "../../shared/utils/sha256";

export interface SourceFilePayload {
    absolutePath: string;
    buffer: ArrayBuffer;
    size: number;
    sha256: string;
}

export interface ReadAndVerifySourceFileOptions {
    /** When set, digest must match or an error is thrown. */
    expectedSha256?: string;
    /** Reject files larger than this many bytes. */
    maxBytes?: number;
    /** When false, allow zero-byte files (default rejects empty). */
    allowEmpty?: boolean;
}

/** Copy a Node.js Buffer view to a standalone ArrayBuffer. */
export function nodeBufferToArrayBuffer(nodeBuffer: Buffer): ArrayBuffer {
    return nodeBuffer.buffer.slice(
        nodeBuffer.byteOffset,
        nodeBuffer.byteOffset + nodeBuffer.byteLength
    ) as ArrayBuffer;
}

/** Read a local file with basic validation and SHA-256 digest. */
export async function readAndVerifySourceFile(
    filePath: string,
    options: ReadAndVerifySourceFileOptions = {}
): Promise<SourceFilePayload> {
    const absolutePath = resolve(filePath);
    const allowEmpty = options.allowEmpty === true;

    try {
        await access(absolutePath);
    } catch {
        throw new Error(`Source file not found: ${absolutePath}`);
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
        throw new Error(`Source path is not a file: ${absolutePath}`);
    }
    if (!allowEmpty && fileStat.size <= 0) {
        throw new Error(`Source file is empty: ${absolutePath}`);
    }
    if (options.maxBytes != null && fileStat.size > options.maxBytes) {
        throw new Error(
            `Source file exceeds maxBytes (${fileStat.size} > ${options.maxBytes}): ${absolutePath}`
        );
    }

    const nodeBuffer = await readFile(absolutePath);
    const buffer = nodeBufferToArrayBuffer(nodeBuffer);

    if (buffer.byteLength !== fileStat.size) {
        throw new Error(
            `Source file size mismatch after read (${buffer.byteLength} !== ${fileStat.size}): ${absolutePath}`
        );
    }

    const digest = await sha256Hex(buffer);

    if (
        options.expectedSha256 != null &&
        digest.toLowerCase() !== options.expectedSha256.toLowerCase()
    ) {
        throw new Error(
            `Source file SHA-256 mismatch (expected ${options.expectedSha256}, got ${digest}): ${absolutePath}`
        );
    }

    return {
        absolutePath,
        buffer,
        size: buffer.byteLength,
        sha256: digest,
    };
}
