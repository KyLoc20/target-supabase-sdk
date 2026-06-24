import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { postTask, type PostTaskPayload } from "../src/task/task.api.js";
import { TaskStatus } from "../src/task/task.interface.js";
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

function parseTaskStatus(raw: string | undefined): TaskStatus.OPEN | TaskStatus.TODO {
    const normalized = raw?.trim().toUpperCase();
    if (normalized == null || normalized === "") {
        return TaskStatus.TODO;
    }
    if (normalized === TaskStatus.OPEN || normalized === TaskStatus.TODO) {
        return normalized;
    }
    throw new Error(`--status must be OPEN or TODO, got: ${raw}`);
}

function buildDefaultPayload(): PostTaskPayload {
    return {
        name: "Weather Taipei",
        value: "weather",
        params: { city: "Taipei" },
        tagList: [],
        taskStatus: TaskStatus.TODO,
    };
}

function buildPayloadFromArgs(args: Record<string, string>): PostTaskPayload {
    if (args.file != null && args.file !== "") {
        const filePath = resolve(projectRoot, args.file);
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as PostTaskPayload;
        return raw;
    }

    const defaults = buildDefaultPayload();
    const taskTypeKey = args.value ?? defaults.value;
    const name = args.name ?? defaults.name;
    const taskStatus = parseTaskStatus(args.status ?? defaults.taskStatus);

    let params: unknown = defaults.params;
    if (args.params != null) {
        params = JSON.parse(args.params);
    } else if (args.city != null) {
        params = { city: args.city };
    }

    return {
        name,
        value: taskTypeKey,
        params,
        taskStatus,
        tagList: defaults.tagList,
        extra: args.extra,
    };
}

function printUsage(): void {
    console.log(`Usage: pnpm post-task [-- options]

Options (all optional; defaults to local weather task):
  --file <path>       JSON payload matching PostTaskPayload (overrides other flags)
  --name <string>     Task display name
  --value <string>    Task type key (task.value = Repo.value)
  --params <json>     Task params JSON, e.g. '{"city":"Taipei"}'
  --city <string>     Shorthand for weather params
  --status OPEN|TODO  Initial status (default: TODO)
  --extra <string>    Optional target.extra

Examples:
  pnpm post-task
  pnpm post-task -- --city Kaohsiung --name "高雄天氣"
  pnpm post-task -- --status OPEN --value weather --params '{"city":"Taipei"}'
  pnpm post-task -- --file scripts/post-task.example.json
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
    const { data, error } = await postTask(payload);

    if (error) {
        throw new Error(error.message);
    }

    console.log("[post-task] created:", {
        id: data?.id,
        name: data?.name,
        value: data?.value,
        status: data?.details.status,
        params: data?.details.params,
    });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[post-task] fatal:", message);
    process.exit(1);
});
