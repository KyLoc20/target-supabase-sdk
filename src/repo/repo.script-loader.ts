import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoggerWithScope } from "../shared/log";
import { resolvePathFromCwd, toFileImportHref } from "../shared/utils/config-path.utils";
import type { TaskRepoScriptRecord } from "../task/task-repo-context";
import { getScriptLoadKey, type LoadedRepoContext, normalizeRepoContextModule } from "./repo-context.utils";

const importedModuleCache = new Map<string, LoadedRepoContext>();

async function importFromFilePath(modulePath: string): Promise<unknown> {
    return import(toFileImportHref(modulePath));
}

/** Resolve repo `details.url` to a value suitable for dynamic `import()`. */
export function resolveRepoEntryHref(url: string, cwd = process.cwd()): string {
    const trimmed = url.trim();
    if (trimmed.includes("://")) {
        return trimmed;
    }
    return toFileImportHref(resolvePathFromCwd(cwd, trimmed));
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
    logger: LoggerWithScope;
    script: TaskRepoScriptRecord;
    taskTypeKey: string;
}): Promise<LoadedRepoContext | null> {
    const loadKey = getScriptLoadKey(script);
    const cacheKey = `${taskTypeKey}@${loadKey}`;
    const cached = importedModuleCache.get(cacheKey);
    if (cached != null) {
        logger.info("命中 Repo 脚本模块缓存", { topic: "repo", data: { cacheKey } });
        return cached;
    }

    const { source, modulePath, exportName } = script.details;

    try {
        let moduleExports: unknown;
        if (source != null && source.trim() !== "") {
            logger.info("从 source 动态加载 Repo 脚本", { topic: "repo", data: { scriptId: script.id } });
            moduleExports = await importFromSource(source, cacheKey);
        } else if (modulePath != null && modulePath.trim() !== "") {
            logger.info("从 modulePath 动态加载 Repo 脚本", {
                topic: "repo",
                data: { scriptId: script.id, modulePath },
            });
            moduleExports = await importFromFilePath(modulePath);
        } else {
            logger.warn("脚本缺少 source 或 modulePath", { topic: "repo", data: { scriptId: script.id } });
            return null;
        }

        const context = normalizeRepoContextModule(moduleExports, taskTypeKey, exportName);
        if (context == null) {
            logger.warn("脚本模块未导出合法的 TaskRepoContext", {
                topic: "repo",
                data: { scriptId: script.id, exportName: exportName ?? "default" },
            });
            return null;
        }

        const loaded: LoadedRepoContext = { context, contentHash: loadKey };
        importedModuleCache.set(cacheKey, loaded);
        return loaded;
    } catch (error) {
        logger.error("动态加载 Repo 脚本失败", {
            topic: "repo",
            data: { scriptId: script.id, error: error instanceof Error ? error.message : error },
        });
        return null;
    }
}

export async function loadRepoContextFromUrl({
    logger,
    url,
    taskTypeKey,
    exportName,
}: {
    logger: LoggerWithScope;
    url: string;
    taskTypeKey: string;
    exportName?: string;
}): Promise<LoadedRepoContext | null> {
    const href = resolveRepoEntryHref(url);
    const cacheKey = `${taskTypeKey}@url:${href}`;
    const cached = importedModuleCache.get(cacheKey);
    if (cached != null) {
        logger.info("命中 Repo URL 模块缓存", { topic: "repo", data: { cacheKey } });
        return cached;
    }

    try {
        logger.info("从 Repo URL 动态加载脚本", { topic: "repo", data: { url, href } });
        const moduleExports = await import(href);
        const context = normalizeRepoContextModule(moduleExports, taskTypeKey, exportName);
        if (context == null) {
            logger.warn("Repo URL 模块未导出合法的 TaskRepoContext", {
                topic: "repo",
                data: { url, exportName: exportName ?? "default" },
            });
            return null;
        }
        const loaded: LoadedRepoContext = { context, contentHash: cacheKey };
        importedModuleCache.set(cacheKey, loaded);
        return loaded;
    } catch (error) {
        logger.error("从 Repo URL 动态加载失败", {
            topic: "repo",
            data: { url, error: error instanceof Error ? error.message : error },
        });
        return null;
    }
}

/** Clear in-memory imported module cache (tests / hot reload). */
export function clearRepoScriptModuleCache(): void {
    importedModuleCache.clear();
}
