import { generateResponse, Target, TargetPayload } from "./core.interface";
import { SupabaseInitializer } from "./supabase";

const supabase = SupabaseInitializer.getInstance();
import { BaseValidator, handleSupabaseError } from "./core.utils";
import { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import type { ZodType } from "zod";
import { ZodError } from "zod";

export interface QueryFilter {
  field: string;
  operator: "eq" | "neq" | "in";
  value: unknown;
}

export const MAX_TARGET_LIST_PAGE_SIZE = 100;

/** Alias for {@link pollTargetList} batch size cap. */
export const MAX_POLL_TARGET_LIST_SIZE = MAX_TARGET_LIST_PAGE_SIZE;

const TARGET_LIST_ORDER_FIELDS = new Set<string>(["created_at", "name", "value", "category"]);

// biome-ignore lint/suspicious/noExplicitAny: PostgrestFilterBuilder is generic over schema
export type TargetFilterBuilder = PostgrestFilterBuilder<any, any, any[], "target", unknown>;

function validateTargetListPagination(pageNum: number, pageSize: number): void {
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    throw new Error(`[getTargetList] pageNum must be a non-negative integer, got ${pageNum}`);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_TARGET_LIST_PAGE_SIZE) {
    throw new Error(
      `[getTargetList] pageSize must be an integer between 1 and ${MAX_TARGET_LIST_PAGE_SIZE}, got ${pageSize}`
    );
  }
}

function resolveTargetListPagination(params: {
  pageNum?: number;
  pageSize?: number;
  limit?: number;
}): {
  pageNum: number;
  pageSize: number;
} {
  if (params.limit != null) {
    validateTargetListPagination(0, params.limit);
    return { pageNum: 0, pageSize: params.limit };
  }
  if (params.pageNum === undefined || params.pageSize === undefined) {
    throw new Error("[getTargetList] Provide pageNum and pageSize, or limit.");
  }
  validateTargetListPagination(params.pageNum, params.pageSize);
  return { pageNum: params.pageNum, pageSize: params.pageSize };
}

function validateTargetListOrderBy(orderBy: QueryOrderBy): void {
  if (!TARGET_LIST_ORDER_FIELDS.has(orderBy.field)) {
    throw new Error(
      `[getTargetList] Unsupported orderBy.field "${orderBy.field}"; allowed: ${[...TARGET_LIST_ORDER_FIELDS].join(", ")}`
    );
  }
}

/**
 * 构建带 category 作用域的 target 查询（供 getTargetList / getTargetTotalCount / pollTargetList 共用）。
 *
 * 必要性：
 * 1. category 是 target 表的分区维度，所有列表/计数/出队都必须限定 category，避免跨类型扫表。
 * 2. 传入 filterBuilder 时仍强制 `.eq("category", category)`，防止自定义 builder 漏加 category 导致误查或安全问题。
 * 3. 统一 select 普通列表与 count head 两种查询形态，再叠加 filterList，避免三处复制分支逻辑。
 */
function buildCategoryScopedQuery({
  category,
  filterList,
  filterBuilder,
  select,
  selectOptions,
}: {
  category: Target["category"];
  filterList: QueryFilter[];
  filterBuilder?: TargetFilterBuilder;
  select: string;
  selectOptions?: { count: "exact"; head: true };
}) {
  const base =
    filterBuilder != null
      ? filterBuilder.eq("category", category)
      : selectOptions != null
        ? supabase.client.from("target").select(select, selectOptions).eq("category", category)
        : supabase.client.from("target").select(select).eq("category", category);

  return applyQueryFilters(base, filterList);
}

// biome-ignore lint/suspicious/noExplicitAny: PostgrestFilterBuilder is generic over schema
function applyQueryFilter<Q extends PostgrestFilterBuilder<any, any, any, any, any>>(
  query: Q,
  filter: QueryFilter
): Q {
  switch (filter.operator) {
    case "eq":
      return query.eq(filter.field, filter.value) as Q;
    case "neq":
      return query.neq(filter.field, filter.value) as Q;
    case "in":
      return query.in(filter.field, filter.value as unknown[]) as Q;
    default: {
      const unsupportedOperator: never = filter.operator;
      throw new Error(`[applyQueryFilter] Unsupported operator: ${unsupportedOperator}`);
    }
  }
}

// biome-ignore lint/suspicious/noExplicitAny: PostgrestFilterBuilder is generic over schema
function applyQueryFilters<Q extends PostgrestFilterBuilder<any, any, any, any, any>>(
  query: Q,
  filterList: QueryFilter[]
): Q {
  return filterList.reduce((q, filter) => applyQueryFilter(q, filter), query);
}

export interface QueryOrderBy {
  field: string;
  ascending: boolean;
}

export interface BaseQueryParams {
  filterList?: QueryFilter[];
  orderBy?: QueryOrderBy;
}

export const getTarget = async ({ id, filterList }: { id: string; filterList?: QueryFilter[] }) => {
  const query =
    filterList != null && filterList.length > 0
      ? applyQueryFilters(supabase.client.from("target").select().eq("id", id), filterList)
      : supabase.client.from("target").select().eq("id", id);

  const { data, error } = await query.single();
  if (error) {
    handleSupabaseError("getTarget", error, "Failed to fetch target.");
  }
  return generateResponse.success<Target>(data as Target);
};

export const getPossibleTarget = async ({ filterList }: { filterList: QueryFilter[] }) => {
  const query = applyQueryFilters(supabase.client.from("target").select(), filterList);

  const { data, error } = await query.maybeSingle();
  if (error) {
    handleSupabaseError("getPossibleTarget", error, "Failed to fetch target.");
  }
  return generateResponse.success<Target | null>(data);
};

export interface GetTargetListParams extends BaseQueryParams {
  category: Target["category"];
  /** 0-based page index. Required with pageSize unless `limit` is set. */
  pageNum?: number;
  pageSize?: number;
  /** Shorthand for `{ pageNum: 0, pageSize: limit }`. Max {@link MAX_TARGET_LIST_PAGE_SIZE}. */
  limit?: number;
  /** PostgREST select clause; defaults to `"*"`. */
  selectFields?: string;
  /** Custom query builder; `category` and `filterList` are still applied. */
  filterBuilder?: TargetFilterBuilder;
}

/**
 * Paginated target list by category. Failures throw via `handleSupabaseError` (no `{ error }` envelope).
 */
export const getTargetList = async <T extends Target = Target>({
  pageNum,
  pageSize,
  limit,
  category,
  filterList = [],
  orderBy = { field: "created_at", ascending: false },
  selectFields = "*",
  filterBuilder,
}: GetTargetListParams) => {
  const { pageNum: resolvedPageNum, pageSize: resolvedPageSize } = resolveTargetListPagination({
    pageNum,
    pageSize,
    limit,
  });
  validateTargetListOrderBy(orderBy);

  const query = buildCategoryScopedQuery({
    category,
    filterList,
    filterBuilder,
    select: selectFields,
  });

  const { data, error } = await query
    .order(orderBy.field, { ascending: orderBy.ascending })
    .range(resolvedPageNum * resolvedPageSize, (resolvedPageNum + 1) * resolvedPageSize - 1);

  if (error) {
    handleSupabaseError("getTargetList", error, "Failed to fetch target list.");
  }
  return generateResponse.success<T[]>((data ?? []) as T[]);
};

export interface ScanTargetListParams {
  category: Target["category"];
  filterList?: QueryFilter[];
  orderBy?: QueryOrderBy;
  selectFields?: string;
  filterBuilder?: TargetFilterBuilder;
  /** Stop after this many rows (optional guard against runaway scans). */
  maxRows?: number;
}

/**
 * Scan all rows matching `category` + `filterList` by paging until exhausted.
 *
 * Use for worker bootstrap / sync jobs that need the full matching set.
 * For UI pagination, use {@link getTargetList} (single page, explicit pageNum).
 *
 * Internal batch size is fixed at {@link MAX_TARGET_LIST_PAGE_SIZE} (PostgREST max-rows).
 * Callers receive the full merged result; they do not pass a per-request page size.
 *
 * Uses offset pagination (`.range`). Stable enough for small catalogs (e.g. Repo registry);
 * for large tables under concurrent writes, consider a DB RPC or keyset pagination later.
 */
export const scanTargetList = async <T extends Target = Target>({
  category,
  filterList = [],
  orderBy = { field: "created_at", ascending: false },
  selectFields = "*",
  filterBuilder,
  maxRows,
}: ScanTargetListParams) => {
  const batchSize = MAX_TARGET_LIST_PAGE_SIZE;
  validateTargetListOrderBy(orderBy);
  if (maxRows != null && (!Number.isInteger(maxRows) || maxRows < 1)) {
    throw new Error(`[scanTargetList] maxRows must be a positive integer, got ${maxRows}`);
  }

  const rows: T[] = [];
  let pageNum = 0;

  while (true) {
    const query = buildCategoryScopedQuery({
      category,
      filterList,
      filterBuilder,
      select: selectFields,
    });

    const { data, error } = await query
      .order(orderBy.field, { ascending: orderBy.ascending })
      .range(pageNum * batchSize, (pageNum + 1) * batchSize - 1);

    if (error) {
      handleSupabaseError("scanTargetList", error, "Failed to scan target list.");
    }

    const page = (data ?? []) as T[];
    if (page.length === 0) {
      break;
    }

    rows.push(...page);

    if (maxRows != null && rows.length >= maxRows) {
      rows.length = maxRows;
      break;
    }

    if (page.length < batchSize) {
      break;
    }

    pageNum += 1;
  }

  return generateResponse.success(rows);
};

export interface GetTargetTotalCountParams extends BaseQueryParams {
  category: Target["category"];
  /** Custom query builder; `category` and `filterList` are still applied. */
  filterBuilder?: TargetFilterBuilder;
}
export const getTargetTotalCount = async ({
  category,
  filterList = [],
  filterBuilder,
}: GetTargetTotalCountParams) => {
  const query = buildCategoryScopedQuery({
    category,
    filterList,
    filterBuilder,
    select: "id",
    selectOptions: { count: "exact", head: true },
  });

  const { count, error } = await query;

  if (error) {
    handleSupabaseError("getTargetTotalCount", error, "Failed to fetch target count.");
  }
  return generateResponse.success<number>(count ?? 0);
};

function validatePollTargetListSize(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > MAX_POLL_TARGET_LIST_SIZE) {
    throw new Error(
      `[pollTargetList] size must be an integer between 1 and ${MAX_POLL_TARGET_LIST_SIZE}, got ${size}`
    );
  }
}

export interface PollTargetListParams {
  category: Target["category"];
  /** Max rows to read and attempt dequeue (not offset pagination). */
  size: number;
  filterList?: QueryFilter[];
  /** Order by `created_at`. Default `true` (oldest first). */
  ascending?: boolean;
  selectFields?: string;
}

/**
 * Queue poll: SELECT up to `size` rows matching `category` + `filterList`, ordered by
 * `created_at`, then DELETE each by `id`. Returns only dequeued rows (at-most-once).
 *
 * Delete failures (concurrent consumer) are skipped silently.
 * Failures on the initial SELECT throw via `handleSupabaseError`.
 *
 * TODO(concurrency): 当前为 SELECT → 逐条 DELETE，非 DB 原子出队，多 consumer 并发时可能：
 * - 重叠读取：两个 worker 同一批 SELECT 命中相同行，靠 DELETE 竞速，后者 skip（多数 at-most-once）
 * - TOCTOU：SELECT 与 DELETE 之间无锁，极端情况下 DELETE 0 行仍不报错 → 可能重复计入 polled
 * - 非 exactly-once：行已删但 worker 崩溃未处理 → 消息丢失
 * 若同一 filter 多实例 poll（或多 worker 同 nodeId），需改为 DB 侧原子方案，例如：
 * - RPC：`DELETE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`
 * - 或 claim 状态机：UPDATE … WHERE pending → DELETE/标记已消费（类似 patchClaimTask 乐观锁）
 * - 短期加固：DELETE 后校验影响行数，0 行则不 push 到 polled
 */
export const pollTargetList = async <T extends Target = Target>({
  category,
  size,
  filterList = [],
  ascending = true,
  selectFields = "*",
}: PollTargetListParams) => {
  validatePollTargetListSize(size);

  const query = buildCategoryScopedQuery({
    category,
    filterList,
    select: selectFields,
  });

  const { data, error } = await query.order("created_at", { ascending }).limit(size);

  if (error) {
    handleSupabaseError("pollTargetList", error, "Failed to fetch targets for poll.");
  }

  const candidates = (data ?? []) as T[];
  const polled: T[] = [];

  for (const row of candidates) {
    try {
      await deleteTarget({ id: row.id });
      polled.push(row);
    } catch {
      // Concurrent dequeue — row already removed
    }
  }

  return generateResponse.success<T[]>(polled);
};

export const deleteTarget = async ({ id, filterList }: { id: string; filterList?: QueryFilter[] }) => {
  // Check whether the target exists given filterList
  if (filterList != null && filterList.length > 0) {
    const query = applyQueryFilters(supabase.client.from("target").select().eq("id", id), filterList);
    const { data: existingTarget, error: existingError } = await query.single();
    if (existingError || existingTarget == null) {
      const msg = `[deleteTarget] Cannot find the target ${id}`;
      console.error(msg, { filterList }, existingError);
      throw new Error(msg);
    }
  }
  const { error } = await supabase.client.from("target").delete().eq("id", id);
  if (error) {
    handleSupabaseError("deleteTarget", error, `Failed to delete target ${id}.`);
  }
  return generateResponse.success();
};

export interface PostTargetPayload {
  name: Target["name"];
  category: Target["category"];
  value: Target["value"];
  tagList: Target["tagList"];
  extra?: Target["extra"];
  details?: Target["details"];
}

class PostTargetPayloadValidator extends BaseValidator<PostTargetPayload> {
  protected requiredFields: (keyof PostTargetPayload)[] = ["category", "name", "value", "tagList"];
  protected optionalFields: (keyof PostTargetPayload)[] = ["extra", "details"];

  constructor() {
    super();
    // Add custom
    this.addCustomValidator((val) => {
      return true;
    });
  }
}

export const postTarget = async (payload: PostTargetPayload) => {
  const validPayload = new PostTargetPayloadValidator().validate(payload);

  const { data, error } = await supabase.client
    .from("target")
    .insert([{ ...validPayload }])
    .select()
    .single();

  if (error) {
    handleSupabaseError("postTarget", error, "Failed to create target.");
  }
  return generateResponse.success<Target>(data as Target);
};

export interface PatchTargetPayload extends PostTargetPayload {
  id: string;
}

export const patchTarget = async ({ id, ...restPayload }: PatchTargetPayload) => {
  const { data: currentData, error: fetchError } = await supabase.client.from("target").select().eq("id", id).single();
  if (!currentData) {
    throw new Error("Target NOT exists");
  }
  if (fetchError) handleSupabaseError("patchTarget", fetchError, "Failed to fetch target.");

  const updatedTarget = new PostTargetPayloadValidator().validate(restPayload);

  const { data, error } = await supabase.client
    .from("target")
    .update({
      ...updatedTarget,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    handleSupabaseError("patchTarget", error, "Failed to update target.");
  }
  return generateResponse.success<Target>(data as Target);
};

/**
 * Read-modify-write `target.details` with optional DB-level optimistic locking on UPDATE.
 *
 * Do not use application-layer pre-update validators (e.g. checking state after SELECT then
 * UPDATE with only `id`). That pattern is not atomic and loses under concurrency. Pass expected
 * row conditions via `optimisticLockFilterList` so they are applied on the UPDATE statement.
 */
export interface UpdateTargetDetailsParams<D> {
  /** Target row id. */
  id: string;
  /**
   * Computes new details from the row fetched immediately before UPDATE.
   * Runs after SELECT; the write still relies on `optimisticLockFilterList` for atomic guards.
   */
  updateFn: (existing: D) => D;
  /**
   * Optional `target.extra` derived from existing details (written together with details).
   */
  updateExtraFn?: (existing: D) => string;
  /**
   * Optimistic lock conditions applied on UPDATE (not on the prior SELECT).
   *
   * Replaces the removed `beforeUpdateValidator`: validators ran in app code between read and
   * write and could not prevent concurrent overwrites. These filters become part of the UPDATE
   * WHERE clause (via `applyQueryFilters`), e.g. `{ field: "details->>status", operator: "eq", value: "TODO" }`.
   *
   * If no row matches after UPDATE, throws "Optimistic lock failed". Empty array = update by id only.
   */
  optimisticLockFilterList?: QueryFilter[];
}

export const updateTargetDetails = async <T, D>({
  id,
  updateFn,
  updateExtraFn,
  optimisticLockFilterList = [],
}: UpdateTargetDetailsParams<D>) => {
  const { data: currentData, error: fetchError } = await supabase.client
    .from("target")
    .select("details")
    .eq("id", id)
    .single();

  if (fetchError) {
    handleSupabaseError("updateTargetDetails", fetchError, "Failed to fetch target.");
  }
  if (!currentData) {
    const msg = "[updateTargetDetails] Target NOT exists: " + id;
    console.error(msg);
    throw new Error(msg);
  }

  const currentDetails = currentData.details as D;
  const updatedDetails: D = updateFn(currentDetails);
  const updated =
    updateExtraFn == null
      ? {
        details: updatedDetails,
      }
      : {
        details: updatedDetails,
        extra: updateExtraFn(currentDetails),
      };

  const updateQuery = applyQueryFilters(
    supabase.client.from("target").update(updated).eq("id", id),
    optimisticLockFilterList
  );

  const { data, error } = await updateQuery.select().maybeSingle();

  if (error) {
    handleSupabaseError("updateTargetDetails", error, "Failed to update target details.");
  }
  if (!data) {
    const msg =
      optimisticLockFilterList.length > 0
        ? OPTIMISTIC_LOCK_FAILED_MESSAGE
        : "[updateTargetDetails] Target not found or was deleted.";
    throw new Error(msg);
  }

  return data as T;
};

export const OPTIMISTIC_LOCK_FAILED_MESSAGE =
  "[updateTargetDetails] Optimistic lock failed: target no longer matches expected state.";

export const CREATE_TARGET_ALREADY_EXISTS_MESSAGE = "[createTarget] Target already exists";

const CREATE_TARGET_REDUNDANCY_MISMATCH_MESSAGE =
  "[createTarget] Inserted row does not match checkRedundancyFilterList; verify createFn aligns with filters.";

/** Max rows to fetch during post-verify — only need to detect one other match. */
const REDUNDANCY_VERIFY_ROW_LIMIT = 2;

export function isOptimisticLockError(error: unknown): boolean {
  return error instanceof Error && error.message === OPTIMISTIC_LOCK_FAILED_MESSAGE;
}

export function isCreateTargetAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && error.message === CREATE_TARGET_ALREADY_EXISTS_MESSAGE;
}

/** Roll back an optimistic insert when redundancy filters match other rows. */
async function rollbackCreateTargetInsert(id: string) {
  const { error } = await supabase.client.from("target").delete().eq("id", id);
  if (error) {
    handleSupabaseError("createTarget", error, "Failed to rollback conflicting insert.");
  }
}

/** Roll back the new row and signal a redundancy conflict to the caller. */
function throwCreateTargetAlreadyExists(checkRedundancyFilterList: QueryFilter[]): never {
  console.error(CREATE_TARGET_ALREADY_EXISTS_MESSAGE, checkRedundancyFilterList);
  throw new Error(CREATE_TARGET_ALREADY_EXISTS_MESSAGE);
}

async function failCreateTargetRedundancy(
  selfId: string,
  checkRedundancyFilterList: QueryFilter[]
): Promise<never> {
  await rollbackCreateTargetInsert(selfId);
  return throwCreateTargetAlreadyExists(checkRedundancyFilterList);
}

/**
 * Create a `target` row with optional payload validation and optimistic redundancy checks.
 *
 * When `checkRedundancyFilterList` is set, uses insert-first + post-verify (not SELECT-before-INSERT).
 * See `.cursor/skills/create-target-redundancy/SKILL.md`.
 */
export const createTarget = async <T extends Target, P extends object>({
  payload,
  validator,
  createFn,
  checkRedundancyFilterList,
  upsert = false,
}: {
  payload: P;
  validator?: new () => BaseValidator<P>;
  createFn: (validPayload: P) => TargetPayload<T>;
  /** Business-key filters; if another row matches after insert, conflict handling runs. */
  checkRedundancyFilterList?: QueryFilter[];
  /**
   * @deprecated Not supported — ignored at runtime. Use domain patch APIs or future RPC upsert.
   * Reserved for a later release; do not pass `true`.
   */
  upsert?: boolean;
}) => {
  if (upsert) {
    console.warn("[createTarget] `upsert` is deprecated and has no effect.");
  }

  const validPayload = validator != null ? new validator().validate(payload) : payload;
  const newTarget = createFn(validPayload);

  const hasRedundancyCheck =
    checkRedundancyFilterList != null && checkRedundancyFilterList.length > 0;

  // 1. Optimistic insert (see create-target-redundancy skill)
  const { data, error } = await supabase.client.from("target").insert([newTarget]).select().single();
  if (error) {
    handleSupabaseError("createTarget", error, "Failed to create target.");
  }

  if (!hasRedundancyCheck) {
    return generateResponse.success<T>(data);
  }

  // 2. Post-verify: limit(2) — enough to detect one other row matching the business-key filters
  const { data: matches, error: matchError } = await applyQueryFilters(
    supabase.client.from("target").select("id"),
    checkRedundancyFilterList
  ).limit(REDUNDANCY_VERIFY_ROW_LIMIT);
  if (matchError) {
    handleSupabaseError("createTarget", matchError, "Failed to verify target redundancy.");
  }

  const selfId = data.id as string;
  const rows = matches ?? [];
  const selfMatchesFilters = rows.some((row) => row.id === selfId);
  if (!selfMatchesFilters) {
    console.warn(CREATE_TARGET_REDUNDANCY_MISMATCH_MESSAGE, checkRedundancyFilterList);
  }

  const hasOtherRow = rows.some((row) => row.id !== selfId);

  // 3. No conflict — keep the inserted row; otherwise rollback and reject
  if (!hasOtherRow) {
    return generateResponse.success<T>(data);
  }

  return failCreateTargetRedundancy(selfId, checkRedundancyFilterList);
};

export function validateWith<P extends object, V extends BaseValidator<P>>(ValidatorClass: new () => V) {
  return <R>(fn: (validPayload: P) => R) => {
    return (payload: P): R => {
      const validPayload = new ValidatorClass().validate(payload);
      return fn(validPayload);
    };
  };
}

function formatZodValidationError(schemaName: string, error: ZodError): Error {
  const errorList = error.issues
    .map((issue, index) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  ${index + 1}. ${path}: ${issue.message}`;
    })
    .join("\n");
  const errorCount = error.issues.length;
  return new Error(
    `[${schemaName}] Validation failed (${errorCount} error${errorCount > 1 ? "s" : ""}):\n${errorList}`
  );
}

/** Zod-based counterpart to {@link validateWith} — requires `zod` as a peer dependency. */
export function validateWithSchema<T extends ZodType>(
  schema: T,
  schemaName = "Schema"
) {
  type Parsed = T["_output"];
  return <R>(fn: (validPayload: Parsed) => R | Promise<R>) => {
    return (payload: Parsed): R | Promise<R> => {
      const result = schema.safeParse(payload);
      if (!result.success) {
        throw formatZodValidationError(schemaName, result.error);
      }
      return fn(result.data);
    };
  };
}
