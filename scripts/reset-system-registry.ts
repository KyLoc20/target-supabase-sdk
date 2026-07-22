/**
 * Reset the globally unique `target-system-registry` Config row to fresh EMPTY slots.
 *
 *   pnpm reset:system-registry -- --yes
 *   pnpm reset:system-registry -- --yes --file scripts/system-registry.seed.json
 *
 * Unlike seed (insert-only), this clears ACTIVE slot bindings and replaces the layout.
 * Requires `--yes` — running services may lose registry ownership until they restart.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deleteTarget, type QueryFilter } from "../src/core.api.js";
import {
    getConfig,
    type PostSystemRegistryConfigPayload,
    postSystemRegistryConfig,
    postSystemRegistryConfigSchema,
    resetSystemRegistryConfig,
} from "../src/service/config.api.js";
import { CategoryConfig, TARGET_SYSTEM_REGISTRY_KEY } from "../src/service/config.interface.js";
import { parseServiceSlots } from "../src/service/registry.service.js";
import { ServiceSlotStatus } from "../src/service/service.interface.js";
import { initSupabaseFromEnv } from "./init-supabase.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const configCategoryFilter: QueryFilter = {
    field: "category",
    operator: "eq",
    value: CategoryConfig.CONFIG,
};

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
    console.log(`Usage: pnpm reset:system-registry -- --yes [options]

Required:
  --yes             Confirm destructive reset (clears ACTIVE slot bindings)

Options:
  --file <path>     JSON payload matching PostSystemRegistryConfigPayload
  --recreate        Delete the Config row and insert a fresh one (revision resets to 0)
  --dry-run         Show current vs target layout without writing
  --help            Show this help

Default slots (when --file omitted):
  log-service, watch-service, download-service, storage-service — one EMPTY slot each
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

function summarizeSlots(configId: string | undefined, slotCount: number, activeCount: number): void {
    console.log("[reset-system-registry] current:", {
        id: configId,
        slotCount,
        activeCount,
    });
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true" || args.h === "true") {
        printUsage();
        return;
    }

    if (args.yes !== "true") {
        console.error("[reset-system-registry] refused: pass --yes to confirm reset");
        printUsage();
        process.exit(1);
    }

    await initSupabaseFromEnv(projectRoot);

    const payload = loadPayload(args);
    const targetSlots = payload.slots?.map((slot) => slot.serviceValue) ?? "(defaults)";

    const existing = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
    if (existing.data != null) {
        const slots = parseServiceSlots(existing.data);
        const activeCount = slots.filter((slot) => slot.status === ServiceSlotStatus.ACTIVE).length;
        summarizeSlots(existing.data.id, slots.length, activeCount);

        if (args["dry-run"] === "true") {
            console.log("[reset-system-registry] dry-run — would reset to:", {
                recreate: args.recreate === "true",
                slots: targetSlots,
            });
            return;
        }
    } else if (args["dry-run"] === "true") {
        console.log("[reset-system-registry] dry-run — row missing; would create with:", {
            slots: targetSlots,
        });
        return;
    }

    if (args.recreate === "true" && existing.data != null) {
        await deleteTarget({
            id: existing.data.id,
            filterList: [configCategoryFilter, { field: "value", operator: "eq", value: TARGET_SYSTEM_REGISTRY_KEY }],
        });

        const created = await postSystemRegistryConfig(payload);
        if (!created.success || created.data == null) {
            throw new Error(created.error?.message ?? "postSystemRegistryConfig failed after delete");
        }

        console.log("[reset-system-registry] recreated:", {
            id: created.data.id,
            value: created.data.value,
            slotCount: created.data.details.objects.length,
            slots: targetSlots,
        });
        return;
    }

    const result = await resetSystemRegistryConfig(payload);
    if (!result.success || result.data == null) {
        throw new Error(result.error?.message ?? "resetSystemRegistryConfig failed");
    }

    console.log("[reset-system-registry] reset:", {
        id: result.data.id,
        value: result.data.value,
        slotCount: result.data.details.objects.length,
        slots: targetSlots,
    });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reset-system-registry] fatal:", message);
    process.exit(1);
});
