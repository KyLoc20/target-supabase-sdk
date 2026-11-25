import { scanTargetList, type TargetFilterBuilder } from "../../core.api";
import type { QueryFilter, Target } from "../../core.interface";

export interface GetLatestTargetInput {
    category: string;
    filterList?: QueryFilter[];
    filterBuilder?: TargetFilterBuilder;
    selectFields?: string;
    /**
     * Sort direction for `created_at`. Default **`false`** (newest first) — typical for
     * “latest by name / value” lookups when duplicates may exist.
     */
    ascending?: boolean;
}

/**
 * Duplicate-tolerant Target lookup: `scanTargetList` with `maxRows: 1` ordered by `created_at`.
 *
 * Prefer this over `getPossibleTarget` / PostgREST `.maybeSingle()` when the business key
 * (`name`, `value`, …) can have more than one row — `maybeSingle` fails with PGRST116 or
 * returns an arbitrary row.
 */
export async function getLatestTarget<T extends Target = Target>(input: GetLatestTargetInput): Promise<T | null> {
    const { data = [], error } = await scanTargetList<T>({
        category: input.category,
        filterList: input.filterList ?? [],
        filterBuilder: input.filterBuilder,
        selectFields: input.selectFields ?? "*",
        maxRows: 1,
        orderBy: { field: "created_at", ascending: input.ascending ?? false },
    });

    if (error != null) {
        throw new Error(error.message);
    }

    return data[0] ?? null;
}
