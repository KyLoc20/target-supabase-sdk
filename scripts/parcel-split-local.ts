import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { publishParcel } from "../src/parcel/parcel.service.js";
import { initSupabaseFromEnv } from "./init-supabase.js";
import {
    createLocalDirStorageAdapter,
    exportKeyToJwk,
    keyPathForSourceFile,
    parseArgs,
    projectRoot,
} from "./parcel-local.utils.js";

function printUsage(): void {
    console.log(`Usage: pnpm parcel:split -- --file <path> [options]

Options:
  --file <path>         Local file to split (required)
  --chunk-size <bytes>  Override auto chunk size (default: dynamic by file size)
  --encrypt             Encrypt before chunking (optional)
  --passphrase <text>   Encryption passphrase (e.g. apple); implies --encrypt
  --help                Show this help

Requires Supabase env (.env.local) — persists Parcel via publishParcel.

Output (same directory as --file):
  <file>.parcel-chunk-000.bin, ...
  <file>.parcel.key.jwk         (only when --encrypt without --passphrase)

Examples:
  pnpm parcel:split -- --file ./temp/test.mp4
  pnpm parcel:split -- --file ./data.bin --encrypt --passphrase apple
`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true" || args.h === "true" || args.file == null || args.file === "") {
        printUsage();
        process.exit(args.file == null && args.help !== "true" ? 1 : 0);
    }

    await initSupabaseFromEnv(projectRoot);

    const sourcePath = resolve(args.file);
    const chunkSize = args["chunk-size"] != null ? Number(args["chunk-size"]) : undefined;
    if (chunkSize != null && (!Number.isFinite(chunkSize) || chunkSize <= 0)) {
        throw new Error("--chunk-size must be a positive number");
    }

    const passphrase = args.passphrase;
    const encrypt = args.encrypt === "true" || passphrase != null;
    if (passphrase != null && passphrase === "") {
        throw new Error("--passphrase must not be empty");
    }

    const fileBuffer = await readFile(sourcePath);
    const file = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
    );

    const name = basename(sourcePath);
    const adapter = createLocalDirStorageAdapter(sourcePath);
    const { parcel, key } = await publishParcel({
        file,
        adapters: [adapter],
        name,
        value: name,
        createOptions: { chunkSize, encrypt, passphrase },
    });

    let keyPath: string | undefined;
    if (key != null) {
        keyPath = keyPathForSourceFile(sourcePath);
        await exportKeyToJwk(key, keyPath);
    }

    console.log("[parcel:split] done", {
        source: sourcePath,
        parcelId: parcel.id,
        chunks: parcel.details.chunkList.length,
        size: parcel.details.size,
        encrypted: parcel.details.crypto?.enabled === true,
        passphraseKdf: parcel.details.crypto?.keyDerivation,
        keyFile: keyPath,
    });
}

function basename(sourcePath: string): string {
    const parts = resolve(sourcePath).split(/[/\\]/);
    return parts.at(-1) ?? sourcePath;
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[parcel:split] fatal:", message);
    process.exit(1);
});
