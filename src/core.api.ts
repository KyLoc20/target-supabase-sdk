import { pick } from "lodash-es";
import { generateResponse, Target, TargetPayload } from "./core.interface";
import { supabase } from ".";
import { BaseValidator, handleSupabaseError } from "./core.utils";
import { PostgrestFilterBuilder } from "@supabase/postgrest-js";

export interface QueryFilter {
  field: string;
  operator: "eq" | "in";
  value: unknown;
}

// biome-ignore lint/suspicious/noExplicitAny: PostgrestFilterBuilder is generic over schema
function applyQueryFilter<Q extends PostgrestFilterBuilder<any, any, any, any, any>>(
  query: Q,
  filter: QueryFilter
): Q {
  switch (filter.operator) {
    case "eq":
      return query.eq(filter.field, filter.value) as Q;
    case "in":
      return query.in(filter.field, filter.value as unknown[]) as Q;
    default:
      return query;
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
  pageNum: number;
  pageSize: number;
  category: Target["category"];
}

export const getTargetList = async ({
  pageNum,
  pageSize,
  category,
  filterList = [],
  orderBy = { field: "created_at", ascending: false },
  filterBuilder,
}: GetTargetListParams & {
  // biome-ignore lint/suspicious/noExplicitAny: PostgrestFilterBuilder is generic over schema
  filterBuilder?: PostgrestFilterBuilder<any, any, any[], "target", unknown>;
}) => {
  const query =
    filterBuilder ??
    applyQueryFilters(supabase.client.from("target").select("*").eq("category", category), filterList);

  const { data, error } = await query
    .order(orderBy.field, { ascending: orderBy.ascending })
    .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);

  if (error) {
    handleSupabaseError("getTargetList", error, "Failed to fetch target list.");
  }
  return generateResponse.success<Target[]>(data);
};

export interface GetTargetTotalCountParams extends BaseQueryParams {
  category: Target["category"];
  // biome-ignore lint/suspicious/noExplicitAny: PostgrestFilterBuilder is generic over schema
  filterBuilder?: PostgrestFilterBuilder<any, any, any[], "target", unknown>;
}
export const getTargetTotalCount = async ({
  category,
  filterList = [],
  filterBuilder,
}: GetTargetTotalCountParams) => {
  const query =
    filterBuilder ??
    applyQueryFilters(
      supabase.client
        .from("target")
        .select("id", { count: "exact", head: true })
        .eq("category", category),
      filterList
    );

  const { count, error } = await query;

  if (error) {
    handleSupabaseError("getTargetTotalCount", error, "Failed to fetch target count.");
  }
  return generateResponse.success<number>(count ?? 0);
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
    this.addValidator((val) => {
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

export function isOptimisticLockError(error: unknown): boolean {
  return error instanceof Error && error.message === OPTIMISTIC_LOCK_FAILED_MESSAGE;
}

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
  checkRedundancyFilterList?: QueryFilter[];
  upsert?: boolean;
}) => {
  // (Optional)Step 1: validate payload
  const validPayload = validator != null ? new validator().validate(payload) : payload;

  // (Optional)Step 2: check redundancy
  if (checkRedundancyFilterList != null && checkRedundancyFilterList.length > 0) {
    const query = applyQueryFilters(supabase.client.from("target").select("id"), checkRedundancyFilterList);
    const { data: existingTarget, error: existingError } = await query.maybeSingle();
    if (existingError) {
      handleSupabaseError("createTarget", existingError, "Failed to check target existence.");
    }
    if (existingTarget) {
      if (upsert) {
        const newTarget = createFn(validPayload);
        const updated = pick(newTarget, ["category", "name", "value", "tagList", "extra", "details"]);
        const { data, error } = await supabase.client
          .from("target")
          .update(updated)
          .eq("id", existingTarget.id)
          .select()
          .single();
        if (error) {
          handleSupabaseError("createTarget", error, "Failed to update existing target.");
        }
        return generateResponse.success<T>(data);
      }
      const msg = "[createTarget] Target already exists";
      console.error(msg, checkRedundancyFilterList);
      throw new Error(msg);
    }
  }

  // Step 3: create target
  const newTarget = createFn(validPayload);
  const { data, error } = await supabase.client.from("target").insert([newTarget]).select().single();
  if (error) {
    handleSupabaseError("createTarget", error, "Failed to create target.");
  }
  return generateResponse.success<T>(data);
};

export function validateWith<P extends object, V extends BaseValidator<P>>(ValidatorClass: new () => V) {
  return <R>(fn: (validPayload: P) => R) => {
    return (payload: P): R => {
      const validPayload = new ValidatorClass().validate(payload);
      return fn(validPayload);
    };
  };
}
