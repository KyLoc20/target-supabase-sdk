import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TaskNode } from "../src/task/task-node.js";
import { initSupabaseFromEnv } from "./init-supabase.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
    await initSupabaseFromEnv(projectRoot);

    const taskNode = new TaskNode();
    await taskNode.start();
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[run-node-worker] fatal:", message);
    process.exit(1);
});
