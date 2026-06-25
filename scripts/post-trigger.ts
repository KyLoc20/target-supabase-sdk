import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { postTrigger, type PostTriggerPayload } from "../src/trigger/trigger.api.js";
import { TriggerStatus } from "../src/trigger/trigger.interface.js";
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

function requireArg(args: Record<string, string>, key: string): string {
    const value = args[key]?.trim();
    if (value == null || value === "") {
        throw new Error(`Missing required flag: --${key}`);
    }
    return value;
}

function buildDefaultPayload(): PostTriggerPayload {
    return {
        name: "Daily Taipei Weather",
        value: "daily-weather-taipei",
        status: TriggerStatus.ENABLED,
        schedule: {
            kind: "daily",
            hour: 9,
            minute: 0,
        },
        action: {
            kind: "post_task",
            taskTypeKey: "weather",
            taskParams: { city: "Taipei" },
            taskStatus: TaskStatus.TODO,
        },
        tagList: [],
    };
}

function buildPayloadFromArgs(args: Record<string, string>): PostTriggerPayload {
    if (args.file != null && args.file !== "") {
        const filePath = resolve(projectRoot, args.file);
        return JSON.parse(readFileSync(filePath, "utf8")) as PostTriggerPayload;
    }

    const defaults = buildDefaultPayload();
    const hour = args.hour != null ? Number(args.hour) : defaults.schedule.hour;
    const minute = args.minute != null ? Number(args.minute) : defaults.schedule.minute;

    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        throw new Error(`--hour must be 0-23, got: ${args.hour}`);
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error(`--minute must be 0-59, got: ${args.minute}`);
    }

    let taskParams: unknown = defaults.action.taskParams;
    if (args.params != null) {
        taskParams = JSON.parse(args.params);
    } else if (args.city != null) {
        taskParams = { city: args.city };
    }

    return {
        name: args.name ?? defaults.name,
        value: args.value ?? defaults.value,
        status: defaults.status,
        schedule: {
            kind: "daily",
            hour,
            minute,
        },
        action: {
            kind: "post_task",
            taskTypeKey: args.taskTypeKey ?? defaults.action.taskTypeKey,
            taskParams,
            taskName: args.taskName,
            taskStatus:
                args.taskStatus === TaskStatus.OPEN || args.taskStatus === TaskStatus.TODO
                    ? args.taskStatus
                    : defaults.action.taskStatus,
        },
        tagList: defaults.tagList,
    };
}

function printUsage(): void {
    console.log(`Usage: pnpm post-trigger [-- options]

Options (defaults to daily 09:00 UTC weather trigger):
  --file <path>           JSON payload matching PostTriggerPayload
  --name <string>         Display name
  --value <string>        Unique trigger key
  --hour <0-23>           Daily fire hour (UTC)
  --minute <0-59>         Daily fire minute (UTC)
  --taskTypeKey <string>  Task type key for post_task action
  --taskName <string>     Optional task display name
  --params <json>         Task params JSON
  --city <string>         Shorthand for weather params
  --taskStatus OPEN|TODO  Initial task status (default: TODO)

Examples:
  pnpm post-trigger
  pnpm post-trigger -- --hour 10 --minute 30 --city Kaohsiung --taskTypeKey weather
  pnpm post-trigger -- --file scripts/post-trigger.example.json
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
    const { data, error } = await postTrigger(payload);

    if (error) {
        throw new Error(error.message);
    }

    console.log("[post-trigger] created:", {
        id: data?.id,
        name: data?.name,
        value: data?.value,
        status: data?.details.status,
        schedule: data?.details.schedule,
        action: data?.details.action,
    });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[post-trigger] fatal:", message);
    process.exit(1);
});
