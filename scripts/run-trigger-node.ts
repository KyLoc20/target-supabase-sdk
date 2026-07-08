import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initSupabaseFromEnv } from "./init-supabase.js";
import { LOG_TOPIC_TRIGGER } from "../src/trigger/trigger.constant.js";
import { TriggerManager } from "../src/trigger/trigger-manager.js";
import { TriggerNode } from "../src/trigger/trigger-node.js";
import { postTask } from "../src/task/task-post.api.js";
import { TaskStatus } from "../src/task/task.interface.js";
import { getErrorMessage } from "../src/shared/utils/error.utils.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
    await initSupabaseFromEnv(projectRoot);

    // Register runners before start() — registration closes when TriggerNode bootstraps.
    TriggerManager.registerRunner({
        key: "example-log",
        intervalMs: 5 * 60 * 1000,
        retryCount: 1,
        retryDelayMs: 2_000,
        fn: async (ctx) => {
            ctx.logger.info("example runner tick", { topic: LOG_TOPIC_TRIGGER });
        },
    });

    TriggerManager.registerRunner({
        key: "example-post-task",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 30_000,
        retryCount: 2,
        retryDelayMs: 5_000,
        timeoutMs: 60_000,
        fn: async (ctx) => {
            const { data, error } = await postTask({
                name: "trigger-example",
                value: "example-task",
                params: { source: "run-trigger-node" },
                taskStatus: TaskStatus.TODO,
                tagList: ["trigger-example"],
                traceParentId: ctx.loopTraceId,
            });
            if (error) {
                throw new Error(error.message);
            }
            ctx.logger.success("postTask 成功", {
                topic: LOG_TOPIC_TRIGGER,
                data: { taskId: data?.id, attempt: ctx.attempt },
            });
        },
    });

    const triggerNode = new TriggerNode({ requireRunners: true });
    await triggerNode.start();
}

main().catch((error: unknown) => {
    const message = getErrorMessage(error);
    console.error("[run-trigger-node] fatal:", message);
    process.exit(1);
});
