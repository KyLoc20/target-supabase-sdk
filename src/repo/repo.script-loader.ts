import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { LoggerWithContext } from "../shared/log/log-manager";
import { TaskRepoScriptRecord } from "../task/task-repo-context";
import {
    getScriptLoadKey,
    LoadedRepoContext,
    normalizeRepoContextModule,
} from "./repo-context.utils";

const importedModuleCache = new Map<string, LoadedRepoContext>();

async function importFromFilePath(modulePath: string): Promise<unknown> {
    const href = pathToFileURL(modulePath).href;
    return import(href);
}

async function importFromSource(source: string, cacheKey: string): Promise<unknown> {
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const dir = join(tmpdir(), "target-supabase-sdk", "repo-scripts");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${cacheKey}-${hash}.mjs`);
    await writeFile(filePath, source, "utf8");
    return importFromFilePath(filePath);
}

export async function loadRepoContextFromScript({
    logger,
    script,
    taskTypeKey,
}: {
    logger: LoggerWithContext;
    script: TaskRepoScriptRecord;
    taskTypeKey: string;
}): Promise<LoadedRepoContext | null> {
    const loadKey = getScriptLoadKey(script);
    const cacheKey = `${taskTypeKey}@${loadKey}`;
    const cached = importedModuleCache.get(cacheKey);
    if (cached != null) {
        logger.info("命中 Repo 脚本模块缓存", { topic: "repo", context: { cacheKey } });
        return cached;
    }

    const { source, modulePath, exportName } = script.details;

    try {
        let moduleExports: unknown;
        if (source != null && source.trim() !== "") {
            logger.info("从 source 动态加载 Repo 脚本", { topic: "repo", context: { scriptId: script.id } });
            moduleExports = await importFromSource(source, cacheKey);
        } else if (modulePath != null && modulePath.trim() !== "") {
            logger.info("从 modulePath 动态加载 Repo 脚本", {
                topic: "repo",
                context: { scriptId: script.id, modulePath },
            });
            moduleExports = await importFromFilePath(modulePath);
        } else {
            logger.warn("脚本缺少 source 或 modulePath", { topic: "repo", context: { scriptId: script.id } });
            return null;
        }

        const context = normalizeRepoContextModule(moduleExports, taskTypeKey, exportName);
        if (context == null) {
            logger.warn("脚本模块未导出合法的 TaskRepoContext", {
                topic: "repo",
                context: { scriptId: script.id, exportName: exportName ?? "default" },
            });
            return null;
        }

        const loaded: LoadedRepoContext = { context, contentHash: loadKey };
        importedModuleCache.set(cacheKey, loaded);
        return loaded;
    } catch (error) {
        logger.error("动态加载 Repo 脚本失败", {
            topic: "repo",
            context: { scriptId: script.id, error: error instanceof Error ? error.message : error },
        });
        return null;
    }
}

/** Clear in-memory imported module cache (tests / hot reload). */
export function clearRepoScriptModuleCache(): void {
    importedModuleCache.clear();
}
