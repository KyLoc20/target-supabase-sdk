/**
 * Seed the globally unique `target-system-registry` Config row.
 *
 *   pnpm seed:system-registry
 *   pnpm seed:system-registry -- --file scripts/system-registry.seed.json
 *   pnpm seed:system-registry -- --release watch-service
 *   pnpm seed:system-registry -- --add gc-service
 *   pnpm seed:system-registry -- --release watch-service,log-service --dry-run
 *
 * Idempotent seed: if the row already exists, exits 0 without modifying it.
 * Release mode: force ACTIVE slots for given service keys back to EMPTY (crash recovery).
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
import {
    appendSystemRegistrySlots,
    parseServiceSlots,
    releaseSystemRegistrySlots,
} from "../src/service/registry.service.js";
import { ServiceSlotStatus } from "../src/service/service.interface.js";
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

function parseServiceValueList(raw: string): string[] {
    return [
        ...new Set(
            raw
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value !== ""),
        ),
    ];
}

function printUsage(): void {
    console.log(`Usage: pnpm seed:system-registry [-- options]

Seed (default):
  --file <path>       JSON payload matching PostSystemRegistryConfigPayload
  --help              Show this help

  Default slots (when --file omitted):
    log-service, watch-service, download-service, storage-service, gc-service — one EMPTY slot each

  The Config row is globally unique (category=config, value=${TARGET_SYSTEM_REGISTRY_KEY}).
  Re-running seed is safe: an existing row is left unchanged.

Add mode (append EMPTY slot for new service keys):
  --add <values>      Comma-separated logical service keys (e.g. gc-service)
  --dry-run           Show whether slots would be added (with --add or --release)

Release mode (force ACTIVE → EMPTY for selected services):
  --release <values>  Comma-separated logical service keys (e.g. watch-service or watch-service,log-service)

Examples:
  pnpm seed:system-registry -- --add gc-service
  pnpm seed:system-registry -- --release watch-service
  pnpm seed:system-registry -- --release watch-service --dry-run
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

async function addSlots(args: Record<string, string>): Promise<void> {
    const serviceValues = parseServiceValueList(args.add ?? "");
    if (serviceValues.length === 0) {
        throw new Error("--add requires at least one serviceValue (comma-separated)");
    }

    const existing = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
    if (existing.data == null) {
        throw new Error(`System registry config not found (value=${TARGET_SYSTEM_REGISTRY_KEY}). Run seed first.`);
    }

    const slots = parseServiceSlots(existing.data);
    const toAdd = serviceValues.filter((value) => !slots.some((slot) => slot.serviceValue === value));
    const skipped = serviceValues.filter((value) => !toAdd.includes(value));

    console.log("[seed-system-registry] add target:", {
        serviceValues,
        toAdd,
        skipped,
    });

    if (args["dry-run"] === "true") {
        console.log("[seed-system-registry] dry-run — no changes written");
        return;
    }

    const result = await appendSystemRegistrySlots({ serviceValues });
    console.log("[seed-system-registry] added:", {
        configId: result.config.id,
        added: result.added,
        skipped: result.skipped,
    });
}

async function releaseSlots(args: Record<string, string>): Promise<void> {
    const serviceValues = parseServiceValueList(args.release ?? "");
    if (serviceValues.length === 0) {
        throw new Error("--release requires at least one serviceValue (comma-separated)");
    }

    const existing = await getConfig({ value: TARGET_SYSTEM_REGISTRY_KEY });
    if (existing.data == null) {
        throw new Error(`System registry config not found (value=${TARGET_SYSTEM_REGISTRY_KEY})`);
    }

    const slots = parseServiceSlots(existing.data);
    const activeMatches = slots
        .map((slot, slotIndex) => ({ slot, slotIndex }))
        .filter(({ slot }) => serviceValues.includes(slot.serviceValue) && slot.status === ServiceSlotStatus.ACTIVE);

    console.log("[seed-system-registry] release target:", {
        serviceValues,
        activeCount: activeMatches.length,
        active: activeMatches.map(({ slot, slotIndex }) => ({
            slotIndex,
            serviceValue: slot.serviceValue,
            serviceId: slot.serviceId,
        })),
    });

    if (args["dry-run"] === "true") {
        console.log("[seed-system-registry] dry-run — no changes written");
        return;
    }

    const result = await releaseSystemRegistrySlots({ serviceValues });
    console.log("[seed-system-registry] released:", {
        configId: result.config.id,
        released: result.released,
        unchangedServiceValues: result.unchangedServiceValues,
    });
}

async function seedRegistry(args: Record<string, string>): Promise<void> {
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

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true" || args.h === "true") {
        printUsage();
        return;
    }

    await initSupabaseFromEnv(projectRoot);

    if (args.add != null && args.add !== "" && args.add !== "true") {
        await addSlots(args);
        return;
    }

    if (args.release != null && args.release !== "" && args.release !== "true") {
        await releaseSlots(args);
        return;
    }

    await seedRegistry(args);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[seed-system-registry] fatal:", message);
    process.exit(1);
});
