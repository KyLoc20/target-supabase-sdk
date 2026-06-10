import { pick } from "lodash-es";
import { createResponse, Target } from "./core.interface";
import { supabase } from ".";
import { BaseValidator } from "./core.utils";
import { PostgrestFilterBuilder } from "@supabase/postgrest-js";

export interface QueryFilter {
  field: string;
  operator: "eq";
  value: unknown;
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
      ? filterList.reduce((query, filter) => {
          switch (filter.operator) {
            case "eq":
              return query.eq(filter.field, filter.value);
            default:
              return query;
          }
        }, supabase.client.from("target").select().eq("id", id))
      : supabase.client.from("target").select().eq("id", id);

  const { data, error } = await query.single();
  if (error) {
    console.error("[getTarget] failed:", error?.message);
    throw error;
  }
  return createResponse.success<Target>(data as Target);
};

export const getPossibleTarget = async ({ filterList }: { filterList: QueryFilter[] }) => {
  const query = filterList.reduce((query, filter) => {
    switch (filter.operator) {
      case "eq":
        return query.eq(filter.field, filter.value);
      default:
        return query;
    }
  }, supabase.client.from("target").select());

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[getPossibleTarget] failed:", error?.message);
    throw error;
  }
  return createResponse.success<Target | null>(data);
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
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  filterBuilder?: PostgrestFilterBuilder<any, any, any[], "target", unknown>;
}) => {
  const query =
    filterBuilder ??
    filterList.reduce((query, filter) => {
      switch (filter.operator) {
        case "eq":
          return query.eq(filter.field, filter.value);
        default:
          return query;
      }
    }, supabase.client.from("target").select("*").eq("category", category));

  const { data, error } = await query
    .order(orderBy.field, { ascending: orderBy.ascending })
    .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);

  if (error) {
    console.error("[getTargetList] failed:", error?.message);
    throw error;
  }
  return createResponse.success<Target[]>(data);
};

export interface GetTargetTotalCountParams extends BaseQueryParams {
  category: Target["category"];
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  filterBuilder?: PostgrestFilterBuilder<any, any, any[], "target", unknown>;
}

export const getTargetTotalCount = async ({
  category,
  filterList = [],
  filterBuilder,
}: GetTargetTotalCountParams) => {
  const query =
    filterBuilder ??
    filterList.reduce(
      (query, filter) => {
        switch (filter.operator) {
          case "eq":
            return query.eq(filter.field, filter.value);
          default:
            return query;
        }
      },
      supabase.client
        .from("target")
        .select("id", { count: "exact", head: true }) // head: true means no row payload
        .eq("category", category)
    );

  const { count, error } = await query;

  if (error) {
    console.error("[getTargetTotalCount] failed:", error?.message);
    throw error;
  }
  return createResponse.success<number>(count ?? 0);
};

export const deleteTarget = async ({ id, filterList }: { id: string; filterList?: QueryFilter[] }) => {
  // Check whether the target exists given filterList
  if (filterList != null && filterList.length > 0) {
    const query = filterList.reduce((query, filter) => {
      switch (filter.operator) {
        case "eq":
          return query.eq(filter.field, filter.value);
        default:
          return query;
      }
    }, supabase.client.from("target").select().eq("id", id));
    const { data: existingTarget, error: existingError } = await query.single();
    if (existingError || existingTarget == null) {
      const msg = `[deleteTarget] failed: Cannot find the target ${id} given filterList: ${JSON.stringify(filterList)}`;
      console.error(msg, existingError);
      throw new Error(msg);
    }
  }
  const { error } = await supabase.client.from("target").delete().eq("id", id);
  if (error) {
    const msg = `[deleteTarget] failed: Cannot delete the target ${id}`;
    console.error(msg, error);
    throw new Error(msg);
  }
  return createResponse.success();
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
    throw error;
  }
  return createResponse.success<Target>(data as Target);
};

export interface PatchTargetPayload extends PostTargetPayload {
  id: string;
}

export const patchTarget = async ({ id, ...restPayload }: PatchTargetPayload) => {
  const { data: currentData, error: fetchError } = await supabase.client.from("target").select().eq("id", id).single();
  if (!currentData) {
    throw new Error("Target NOT exists");
  }
  if (fetchError) throw fetchError;

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
    throw error;
  }
  return createResponse.success<Target>(data as Target);
};

export const updateTargetDetails = async <T, D>({
  id,
  updateFn,
  beforeUpdateValidator = () => true,
  updateExtraFn,
}: {
  id: string;
  updateFn: (existing: D) => D;
  beforeUpdateValidator?: (existing: D) => true | string;
  updateExtraFn?: (existing: D) => string;
}) => {
  const { data: currentData, error: fetchError } = await supabase.client
    .from("target")
    .select("details")
    .eq("id", id)
    .single();
  if (!currentData) {
    const msg = "[updateTargetDetails] Target NOT exists: " + id;
    console.error(msg);
    throw new Error(msg);
  }

  const currentDetails = currentData.details as D;

  // Check before update
  const validatorResult = beforeUpdateValidator(currentDetails);
  if (validatorResult !== true) {
    throw new Error("[updateTargetDetails] validation failed. " + validatorResult);
  }

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

  const { data, error } = await supabase.client.from("target").update(updated).eq("id", id).select().single();

  if (error) throw error;
  return data as T;
};

export const createTarget = async <T extends Target, P extends object>({
  payload,
  validator,
  createFn,
  checkRedundancyFilterList,
  upsert = false,
}: {
  payload: P;
  validator?: new () => BaseValidator<P>;
  createFn: (validPayload: P) => Omit<T, "id" | "created_at">;
  checkRedundancyFilterList?: QueryFilter[];
  upsert?: boolean;
}) => {
  // (Optional)Step 1: validate payload
  const validPayload = validator != null ? new validator().validate(payload) : payload;

  // (Optional)Step 2: check redundancy
  if (checkRedundancyFilterList != null && checkRedundancyFilterList.length > 0) {
    const query = checkRedundancyFilterList.reduce((query, filter) => {
      switch (filter.operator) {
        case "eq":
          return query.eq(filter.field, filter.value);
        default:
          return query;
      }
    }, supabase.client.from("target").select("id"));
    const { data: existingTarget, error: existingError } = await query.maybeSingle();
    if (existingError) {
      throw existingError;
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
          throw error;
        }
        return createResponse.success<T>(data);
      }
      const msg = `[createTarget] Target already exists: ${JSON.stringify(checkRedundancyFilterList)}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  // Step 3: create target
  const newTarget = createFn(validPayload);
  const { data, error } = await supabase.client.from("target").insert([newTarget]).select().single();
  if (error) {
    throw error;
  }
  return createResponse.success<T>(data);
};

export function validateWith<P extends object, V extends BaseValidator<P>>(ValidatorClass: new () => V) {
  return <R>(fn: (validPayload: P) => R) => {
    return (payload: P): R => {
      const validPayload = new ValidatorClass().validate(payload);
      return fn(validPayload);
    };
  };
}
