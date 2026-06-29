import { getPossibleTarget } from "../core.api";
import { SupabaseInitializer } from "../supabase";
import { LoggerWithScope } from "../shared/log";
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
    logger: LoggerWithScope;
    /** Task type key (`task.value`) — matches {@link Repo.value} for remote lookup; local registry key */
    taskTypeKey: string;
}

export interface GetRepoContextResult<T extends TaskRepoContext = TaskRepoContext> {
    context: T | null;
    /** Present when `context` is null — import / DB / format failure at repo layer */
    error?: string;
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
    logger: LoggerWithScope,
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
    logger: LoggerWithScope,
    taskTypeKey: string
): Promise<GetRepoContextResult> {
    logger.info("從 Supabase 加載 Repo", { topic: "repo", data: { taskTypeKey } });

    const remoteRepo = await fetchRemoteRepo(taskTypeKey);
    if (remoteRepo == null) {
        const error = `Supabase 未找到 Repo (value=${taskTypeKey})`;
        logger.warn(error, { topic: "repo", data: { taskTypeKey } });
        return { context: null, error };
    }

    const repoUrl = remoteRepo.details?.url?.trim() ?? "";
    const repoHash = remoteRepo.details?.hash?.trim() ?? repoUrl;
    const cacheKey = buildRemoteCacheKey(taskTypeKey, repoHash);
    const cached = remoteContextCache.get(cacheKey);
    if (cached != null) {
        logger.info("命中遠程 Repo 上下文緩存", { topic: "repo", data: { cacheKey } });
        return { context: cached };
    }

    const scripts = await fetchRemoteScripts(taskTypeKey);
    const entryScript = pickEntryScript(scripts);

    let loaded =
        entryScript != null && assertScriptLoadable(entryScript.details)
            ? await loadRepoContextFromScript({ logger, script: entryScript, taskTypeKey })
            : null;

    if (loaded == null && repoUrl !== "") {
        logger.info("未找到 script 行，嘗試從 Repo.details.url 加載", {
            topic: "repo",
            data: { taskTypeKey, url: repoUrl },
        });
        loaded = await loadRepoContextFromUrl({ logger, url: repoUrl, taskTypeKey });
    }

    if (loaded == null) {
        const error = `無法從 Repo 加載 TaskRepoContext (hasUrl=${repoUrl !== ""}, scriptCount=${scripts.length})`;
        logger.warn(error, {
            topic: "repo",
            data: { taskTypeKey, hasUrl: repoUrl !== "", scriptCount: scripts.length },
        });
        return { context: null, error };
    }

    remoteContextCache.set(cacheKey, loaded.context);
    return { context: loaded.context };
}

const getRepoContext = async <RepoContext extends TaskRepoContext>({
    logger,
    taskTypeKey,
}: GetRepoContextParams): Promise<GetRepoContextResult<RepoContext>> => {
    const localEntry = localRepoRegistry.get(taskTypeKey);
    if (localEntry != null) {
        logger.info("使用本地註冊的 Repo", { topic: "repo", data: { taskTypeKey } });
        const context = await loadLocalEntry(logger, localEntry, taskTypeKey);
        if (context != null && isTaskRepoContext(context)) {
            return { context: context as RepoContext };
        }
        const error = "本地 Repo 模組加載失敗或未導出有效的 TaskRepoContext";
        logger.warn(error, { topic: "repo", data: { taskTypeKey } });
        return { context: null, error };
    }

    try {
        const result = await loadRemoteRepoContext(logger, taskTypeKey);
        if (result.context != null && isTaskRepoContext(result.context)) {
            return { context: result.context as RepoContext };
        }
        return {
            context: null,
            error: result.error ?? "遠程 Repo 上下文無效",
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("從 Supabase 加載 Repo 失敗", {
            topic: "repo",
            data: { taskTypeKey, error: message },
        });
        return { context: null, error: message };
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
