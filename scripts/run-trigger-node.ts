import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TriggerNode } from "../src/trigger/trigger-node.js";
import { initSupabaseFromEnv } from "./init-supabase.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
    await initSupabaseFromEnv(projectRoot);

    const triggerNode = new TriggerNode();
    await triggerNode.start();
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[run-trigger-node] fatal:", message);
    process.exit(1);
});
