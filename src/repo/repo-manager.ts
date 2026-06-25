import { getPossibleTarget } from "../core.api";
import { SupabaseInitializer } from "../supabase";
import { LoggerWithContext } from "../shared/log/log-manager";
import type { TaskRepoContext, TaskRepoScriptRecord } from "../task/task-repo-context";
import { TASK_REPO_SCRIPT_CATEGORY } from "../task/task-repo-context";
import {
    assertScriptLoadable,
    isTaskRepoContext,
    pickEntryScript,
} from "./repo-context.utils";
import { CategoryRepo, Repo } from "./repo.interface";
import {
    clearRepoScriptModuleCache,
    loadRepoContextFromScript,
    loadRepoContextFromUrl,
} from "./repo.script-loader";

const supabase = SupabaseInitializer.getInstance();

type LocalRepoEntry =
    | { kind: "context"; context: TaskRepoContext }
    | { kind: "modulePath"; modulePath: string; exportName?: string };

const localRepoRegistry = new Map<string, LocalRepoEntry>();
const remoteContextCache = new Map<string, TaskRepoContext>();

export interface GetRepoContextParams {
    logger: LoggerWithContext;
    /** Task type key (`task.value`) — matches {@link Repo.value} for remote lookup; local registry key */
    taskTypeKey: string;
}

function buildRemoteCacheKey(taskTypeKey: string, contentHash: string): string {
    return `${taskTypeKey}@${contentHash}`;
}

async function fetchRemoteRepo(taskTypeKey: string): Promise<Repo | null> {
    const { data } = await getPossibleTarget({
        filterList: [
            { field: "category", operator: "eq", value: CategoryRepo.REPO },
            { field: "value", operator: "eq", value: taskTypeKey },
        ],
    });
    return (data as Repo | null) ?? null;
}

async function fetchRemoteScripts(taskTypeKey: string): Promise<TaskRepoScriptRecord[]> {
    const { data, error } = await supabase.client
        .from("target")
        .select("id, value, details")
        .eq("category", TASK_REPO_SCRIPT_CATEGORY)
        .eq("value", taskTypeKey);

    if (error) {
        throw error;
    }

    return (data ?? []) as TaskRepoScriptRecord[];
}

async function loadLocalEntry(
    logger: LoggerWithContext,
    entry: LocalRepoEntry,
    taskTypeKey: string
): Promise<TaskRepoContext | null> {
    if (entry.kind === "context") {
        return entry.context;
    }

    const loaded = await loadRepoContextFromScript({
        logger,
        script: {
            id: `local:${taskTypeKey}`,
            value: taskTypeKey,
            details: {
                manifestVersion: 0,
                modulePath: entry.modulePath,
                exportName: entry.exportName,
                isEntry: true,
            },
        },
        taskTypeKey,
    });
    return loaded?.context ?? null;
}

async function loadRemoteRepoContext(
    logger: LoggerWithContext,
    taskTypeKey: string
): Promise<TaskRepoContext | null> {
    logger.info("从 Supabase 加载 Repo", { topic: "repo", context: { taskTypeKey } });

    const remoteRepo = await fetchRemoteRepo(taskTypeKey);
    if (remoteRepo == null) {
        logger.warn("Supabase 未找到 Repo", { topic: "repo", context: { taskTypeKey } });
        return null;
    }

    const repoUrl = remoteRepo.details?.url?.trim() ?? "";
    const repoHash = remoteRepo.details?.hash?.trim() ?? repoUrl;
    const cacheKey = buildRemoteCacheKey(taskTypeKey, repoHash);
    const cached = remoteContextCache.get(cacheKey);
    if (cached != null) {
        logger.info("命中远程 Repo 上下文缓存", { topic: "repo", context: { cacheKey } });
        return cached;
    }

    const scripts = await fetchRemoteScripts(taskTypeKey);
    const entryScript = pickEntryScript(scripts);

    let loaded =
        entryScript != null && assertScriptLoadable(entryScript.details)
            ? await loadRepoContextFromScript({ logger, script: entryScript, taskTypeKey })
            : null;

    if (loaded == null && repoUrl !== "") {
        logger.info("未找到 script 行，尝试从 Repo.details.url 加载", {
            topic: "repo",
            context: { taskTypeKey, url: repoUrl },
        });
        loaded = await loadRepoContextFromUrl({ logger, url: repoUrl, taskTypeKey });
    }

    if (loaded == null) {
        logger.warn("无法从 Repo 加载 TaskRepoContext", {
            topic: "repo",
            context: { taskTypeKey, hasUrl: repoUrl !== "", scriptCount: scripts.length },
        });
        return null;
    }

    remoteContextCache.set(cacheKey, loaded.context);
    return loaded.context;
}

const getRepoContext = async <RepoContext extends TaskRepoContext>({
    logger,
    taskTypeKey,
}: GetRepoContextParams): Promise<RepoContext | null> => {
    const localEntry = localRepoRegistry.get(taskTypeKey);
    if (localEntry != null) {
        logger.info("使用本地注册的 Repo", { topic: "repo", context: { taskTypeKey } });
        const context = await loadLocalEntry(logger, localEntry, taskTypeKey);
        if (context != null && isTaskRepoContext(context)) {
            return context as RepoContext;
        }
        logger.warn("本地 Repo 加载失败", { topic: "repo", context: { taskTypeKey } });
        return null;
    }

    try {
        const context = await loadRemoteRepoContext(logger, taskTypeKey);
        if (context != null && isTaskRepoContext(context)) {
            return context as RepoContext;
        }
        return null;
    } catch (error) {
        logger.error("从 Supabase 加载 Repo 失败", {
            topic: "repo",
            context: { taskTypeKey, error: error instanceof Error ? error.message : error },
        });
        return null;
    }
};

/** Register an in-process TaskRepoContext (highest priority — no Supabase fetch). */
function registerLocalRepoContext(taskTypeKey: string, context: TaskRepoContext): void {
    if (!isTaskRepoContext(context)) {
        throw new Error("[RepoManager] Invalid TaskRepoContext");
    }
    localRepoRegistry.set(taskTypeKey, { kind: "context", context });
}

/** Register a local ESM module path; loaded via dynamic import when the task runs. */
function registerLocalModule(taskTypeKey: string, modulePath: string, exportName?: string): void {
    if (modulePath.trim() === "") {
        throw new Error("[RepoManager] modulePath must not be empty");
    }
    localRepoRegistry.set(taskTypeKey, { kind: "modulePath", modulePath, exportName });
}

function unregisterLocalRepo(taskTypeKey: string): void {
    localRepoRegistry.delete(taskTypeKey);
}

function getRegisteredLocalTaskTypeKeys(): string[] {
    return [...localRepoRegistry.keys()];
}

function clearRemoteContextCache(): void {
    remoteContextCache.clear();
}

const RepoManager = {
    getRepoContext,
    registerLocalRepoContext,
    registerLocalModule,
    unregisterLocalRepo,
    getRegisteredLocalTaskTypeKeys,
    clearRemoteContextCache,
    clearRepoScriptModuleCache,
};

export { RepoManager };
