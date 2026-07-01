import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getParcel } from "../src/parcel/parcel.api.js";
import type { Parcel } from "../src/parcel/parcel.interface.js";
import { restoreParcel } from "../src/parcel/parcel.service.js";
import { initSupabaseFromEnv } from "./init-supabase.js";
import {
    chunkStorageBaseDir,
    importKeyFromJwk,
    installLocalChunkFetch,
    parseArgs,
    projectRoot,
} from "./parcel-local.utils.js";

function printUsage(): void {
    console.log(`Usage: pnpm parcel:restore -- --id <parcelId> --output <path> [options]

Options:
  --id <parcelId>       Parcel id from Supabase (required)
  --output <path>       Restored file path (required)
  --passphrase <text>   Passphrase for PBKDF2-encrypted parcels
  --key-file <path>     JWK key file for raw-key parcels
  --help                Show this help

Requires Supabase env (.env.local).

Examples:
  pnpm parcel:restore -- --id <uuid> --output ./temp/out.mp4 --passphrase apple
  pnpm parcel:restore -- --id <uuid> --output ./out.bin --key-file ./data.bin.parcel.key.jwk
`);
}

async function buildReassembleOptions(
    parcel: Parcel,
    args: Record<string, string>
): Promise<{ key?: CryptoKey; passphrase?: string }> {
    const encrypted = parcel.details.crypto?.enabled === true;
    if (!encrypted) {
        return {};
    }

    const usesPassphrase = parcel.details.crypto?.keyDerivation === "PBKDF2-SHA256";
    if (usesPassphrase) {
        if (args.passphrase == null || args.passphrase === "") {
            throw new Error("此 Parcel 使用口令加密，请提供 --passphrase");
        }
        return { passphrase: args.passphrase };
    }

    if (args["key-file"] == null || args["key-file"] === "") {
        throw new Error("raw-key 加密 Parcel 需要 --key-file");
    }
    return { key: await importKeyFromJwk(resolve(args["key-file"])) };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true" || args.h === "true" || args.output == null || args.id == null || args.id === "") {
        printUsage();
        process.exit(args.output == null || args.id == null ? 1 : 0);
    }

    await initSupabaseFromEnv(projectRoot);

    const outputPath = resolve(args.output);
    const { data: parcel } = await getParcel({ id: args.id });
    if (parcel == null) {
        throw new Error(`getParcel returned no data for id=${args.id}`);
    }

    const reassembleOptions = await buildReassembleOptions(parcel, args);

    const restoreFetch = installLocalChunkFetch(chunkStorageBaseDir(parcel));
    try {
        const restored = await restoreParcel(parcel, reassembleOptions);
        await writeFile(outputPath, Buffer.from(restored));
    } finally {
        restoreFetch();
    }

    const encrypted = parcel.details.crypto?.enabled === true;
    const usesPassphrase = parcel.details.crypto?.keyDerivation === "PBKDF2-SHA256";
    console.log("[parcel:restore] done", {
        parcelId: parcel.id,
        output: outputPath,
        size: parcel.details.size,
        chunks: parcel.details.chunkList.length,
        encrypted,
        passphraseKdf: usesPassphrase,
    });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const detail =
        error instanceof DOMException
            ? `${error.name}: ${error.message}`
            : error instanceof Error && error.cause != null
              ? String(error.cause)
              : undefined;
    console.error("[parcel:restore] fatal:", message);
    if (detail != null && detail !== message) {
        console.error("[parcel:restore] detail:", detail);
    }
    process.exit(1);
});
