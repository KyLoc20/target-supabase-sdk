import { getPossibleTarget } from "../core.api";
import { TargetPayload } from "../core.interface";
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
import { clearRepoScriptModuleCache, loadRepoContextFromScript } from "./repo.script-loader";

const supabase = SupabaseInitializer.getInstance();

type LocalRepoEntry =
    | { kind: "context"; context: TaskRepoContext }
    | { kind: "modulePath"; modulePath: string; exportName?: string };

const localRepoRegistry = new Map<string, LocalRepoEntry>();
const remoteContextCache = new Map<string, TaskRepoContext>();

export interface GetRepoContextParams {
    logger: LoggerWithContext;
    /** Task type key (`task.value`) */
    taskTypeKey: string;
    /** Repo snapshot attached on the task — used for hash verification */
    repo?: TargetPayload<Repo>;
}

function buildCacheKey(taskTypeKey: string, repo?: TargetPayload<Repo>): string {
    const repoHash = repo?.details?.hash ?? "";
    return `${taskTypeKey}@${repoHash}`;
}

function verifyRepoHash(
    logger: LoggerWithContext,
    expectedHash: string | undefined,
    remoteHash: string | undefined
): boolean {
    if (expectedHash == null || expectedHash === "") {
        return true;
    }
    if (remoteHash == null || remoteHash === "") {
        logger.warn("任务携带 repo hash，但远程 Repo 无 hash", { topic: "repo" });
        return false;
    }
    if (expectedHash !== remoteHash) {
        logger.warn("Repo hash 不匹配", {
            topic: "repo",
            context: { expectedHash, remoteHash },
        });
        return false;
    }
    return true;
}

async function fetchRemoteRepo(taskTypeKey: string, repo?: TargetPayload<Repo>): Promise<Repo | null> {
    const repoKey = repo?.value ?? taskTypeKey;
    const { data } = await getPossibleTarget({
        filterList: [
            { field: "category", operator: "eq", value: CategoryRepo.REPO },
            { field: "value", operator: "eq", value: repoKey },
        ],
    });
    return (data as Repo | null) ?? null;
}

async function fetchRemoteScripts(taskTypeKey: string, repo?: TargetPayload<Repo>): Promise<TaskRepoScriptRecord[]> {
    const repoKey = repo?.value ?? taskTypeKey;

    const [byValueResult, byRepoKeyResult] = await Promise.all([
        supabase.client
            .from("target")
            .select("id, value, details")
            .eq("category", TASK_REPO_SCRIPT_CATEGORY)
            .eq("value", repoKey),
        supabase.client
            .from("target")
            .select("id, value, details")
            .eq("category", TASK_REPO_SCRIPT_CATEGORY)
            .eq("details->>repoKey", repoKey),
    ]);

    if (byValueResult.error) {
        throw byValueResult.error;
    }
    if (byRepoKeyResult.error) {
        throw byRepoKeyResult.error;
    }

    const merged = new Map<string, TaskRepoScriptRecord>();
    for (const row of [...(byValueResult.data ?? []), ...(byRepoKeyResult.data ?? [])]) {
        merged.set(row.id, row as TaskRepoScriptRecord);
    }
    return [...merged.values()];
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
    taskTypeKey: string,
    repo?: TargetPayload<Repo>
): Promise<TaskRepoContext | null> {
    const cacheKey = buildCacheKey(taskTypeKey, repo);
    const cached = remoteContextCache.get(cacheKey);
    if (cached != null) {
        logger.info("命中远程 Repo 上下文缓存", { topic: "repo", context: { cacheKey } });
        return cached;
    }

    logger.info("从 Supabase 加载 Repo", { topic: "repo", context: { taskTypeKey } });

    const remoteRepo = await fetchRemoteRepo(taskTypeKey, repo);
    if (remoteRepo == null) {
        logger.warn("Supabase 未找到 Repo", { topic: "repo", context: { taskTypeKey } });
        return null;
    }

    if (!verifyRepoHash(logger, repo?.details?.hash, remoteRepo.details?.hash)) {
        return null;
    }

    const scripts = await fetchRemoteScripts(taskTypeKey, repo);
    const entryScript = pickEntryScript(scripts);
    if (entryScript == null) {
        logger.warn("Repo 下未找到可执行脚本", { topic: "repo", context: { taskTypeKey } });
        return null;
    }

    if (!assertScriptLoadable(entryScript.details)) {
        logger.warn("入口脚本缺少 source 或 modulePath", {
            topic: "repo",
            context: { scriptId: entryScript.id },
        });
        return null;
    }

    const loaded = await loadRepoContextFromScript({ logger, script: entryScript, taskTypeKey });
    if (loaded == null) {
        return null;
    }

    remoteContextCache.set(cacheKey, loaded.context);
    return loaded.context;
}

const getRepoContext = async <RepoContext extends TaskRepoContext>({
    logger,
    taskTypeKey,
    repo,
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
        const context = await loadRemoteRepoContext(logger, taskTypeKey, repo);
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

export default RepoManager;
