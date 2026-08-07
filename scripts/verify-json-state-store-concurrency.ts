import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonFileStateStore } from "../src/node/fs/json-state-store.js";

const defaultState = { count: 0, tags: {} as Record<string, string> };

async function main(): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "json-state-store-verify-"));
    const filePath = join(dir, "state.json");
    const store = createJsonFileStateStore({
        filePath,
        defaultState,
    });

    await Promise.all(
        Array.from({ length: 32 }, (_, index) =>
            store.write({
                count: index,
                tags: { [`runner-${index}`]: String(index) },
            }),
        ),
    );

    const raw = await readFile(filePath, "utf8");
    JSON.parse(raw);
    const state = await store.read();
    if (typeof state.count !== "number") {
        throw new Error(`expected numeric count, got ${String(state.count)}`);
    }

    await rm(dir, { recursive: true, force: true });
    console.log("[verify-json-state-store] concurrent writes OK");
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[verify-json-state-store] failed:", message);
    process.exit(1);
});
