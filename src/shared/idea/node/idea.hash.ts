import { createHash } from "node:crypto";

/** SHA-256 hex of image bytes (filename + `details.original.content` for paste-image ideas). */
export function hashIdeaPasteImage(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
}
