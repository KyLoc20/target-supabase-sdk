/**
 * Seed the globally unique `target-system-registry` Config row.
 *
 *   pnpm seed:system-registry
 *   pnpm seed:system-registry -- --file scripts/system-registry.seed.json
 *
 * Idempotent: if the row already exists, exits 0 without modifying it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCreateTargetAlreadyExistsError } from "../src/core.api.js";
import {
    getConfig,
    type PostSystemRegistryConfigPayload,
    postSystemRegistryConfig,
    postSystemRegistryConfigSchema,
} from "../src/service/config.api.js";
import { TARGET_SYSTEM_REGISTRY_KEY } from "../src/service/config.interface.js";
import { initSupabaseFromEnv } from "./init-supabase.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv: string[]): Record<string, string> {
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

function printUsage(): void {
    console.log(`Usage: pnpm seed:system-registry [-- options]

Options:
  --file <path>   JSON payload matching PostSystemRegistryConfigPayload
  --help          Show this help

Default slots (when --file omitted):
  log-service, watch-service, download-service, storage-service — one EMPTY slot each

The Config row is globally unique (category=config, value=${TARGET_SYSTEM_REGISTRY_KEY}).
Re-running this script is safe: an existing row is left unchanged.
`);
}

function loadPayload(args: Record<string, string>): PostSystemRegistryConfigPayload {
    if (args.file != null && args.file !== "") {
        const filePath = resolve(projectRoot, args.file);
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        return postSystemRegistryConfigSchema.parse(raw);
    }
    return postSystemRegistryConfigSchema.parse({});
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true" || args.h === "true") {
        printUsage();
        return;
    }

    await initSupabaseFromEnv(projectRoot);

    const existing = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
    if (existing.data != null) {
        console.log("[seed-system-registry] already exists — skipping insert", {
            id: existing.data.id,
            value: existing.data.value,
            slotCount: existing.data.details.objects.length,
        });
        return;
    }

    const payload = loadPayload(args);

    try {
        const result = await postSystemRegistryConfig(payload);
        if (!result.success || result.data == null) {
            throw new Error(result.error?.message ?? "postSystemRegistryConfig failed");
        }

        console.log("[seed-system-registry] created:", {
            id: result.data.id,
            value: result.data.value,
            slotCount: result.data.details.objects.length,
            slots: payload.slots?.map((slot) => slot.serviceValue) ?? "(defaults)",
        });
    } catch (error) {
        if (isCreateTargetAlreadyExistsError(error)) {
            const row = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
            console.log("[seed-system-registry] already exists (race) — skipping insert", {
                id: row.data?.id,
                value: TARGET_SYSTEM_REGISTRY_KEY,
            });
            return;
        }
        throw error;
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[seed-system-registry] fatal:", message);
    process.exit(1);
});
