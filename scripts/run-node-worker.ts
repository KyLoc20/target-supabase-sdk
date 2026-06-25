import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeManager } from "../src/node/node-manager.js";
import { initSupabaseFromEnv } from "./init-supabase.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
    await initSupabaseFromEnv(projectRoot);

    const nodeManager = new NodeManager();
    await nodeManager.start();
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[run-node-worker] fatal:", message);
    process.exit(1);
});
