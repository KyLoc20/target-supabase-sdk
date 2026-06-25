import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { postCommand, type PostCommandPayload } from "../src/command/command.api.js";
import { CommandType } from "../src/command/command.interface.js";
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

function parseCommandType(raw: string): CommandType {
    const normalized = raw.trim().toLowerCase();
    const allowed = Object.values(CommandType);
    if (allowed.includes(normalized as CommandType)) {
        return normalized as CommandType;
    }
    throw new Error(`--command must be one of: ${allowed.join(", ")}, got: ${raw}`);
}

function requireArg(args: Record<string, string>, key: string): string {
    const value = args[key]?.trim();
    if (value == null || value === "") {
        throw new Error(`Missing required flag: --${key}`);
    }
    return value;
}

function buildPayloadFromArgs(args: Record<string, string>): PostCommandPayload {
    if (args.file != null && args.file !== "") {
        const filePath = resolve(projectRoot, args.file);
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as PostCommandPayload;
        return raw;
    }

    const nodeId = requireArg(args, "nodeId");
    const command = parseCommandType(requireArg(args, "command"));
    const traceId = args.traceId?.trim() || undefined;

    return { nodeId, command, traceId };
}

function printUsage(): void {
    const commands = Object.values(CommandType).join(", ");
    console.log(`Usage: pnpm post-command -- --nodeId <uuid> --command <type> [options]

Required:
  --nodeId <uuid>       Target node id (command.value)
  --command <type>      Command type: ${commands}

Options:
  --file <path>         JSON payload matching PostCommandPayload (overrides flags)
  --traceId <string>    Optional trace id for logs
  --help                Show this help

Examples:
  pnpm post-command -- --nodeId 209ccb03-591e-47ff-ac5a-99f15c984b72 --command stop-node
  pnpm post-command -- --file scripts/post-command.example.json
`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true" || args.h === "true") {
        printUsage();
        return;
    }

    await initSupabaseFromEnv(projectRoot);

    const payload = buildPayloadFromArgs(args);
    const { data, error } = await postCommand(payload);

    if (error) {
        throw new Error(error.message);
    }

    console.log("[post-command] enqueued:", {
        id: data?.id,
        command: data?.name,
        nodeId: data?.value,
        category: data?.category,
    });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[post-command] fatal:", message);
    process.exit(1);
});
