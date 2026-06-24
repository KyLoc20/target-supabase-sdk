import { scanTargetList, validateWithSchema } from "../core.api";
import { generateResponse, SupabaseResponse } from "../core.interface";
import { z } from "zod";
import { CategoryRepo, Repo } from "./repo.interface";

const REPO_USAGE_FIELD = "details->>usage" as const;

export const getScanRemoteRepoValuesSchema = z.object({
    usage: z.string().trim().min(1),
});

export type GetScanRemoteRepoValuesPayload = z.infer<typeof getScanRemoteRepoValuesSchema>;

/**
 * Scan `Repo.value` keys for `category=repo` with matching `details.usage`.
 * Returns `{ data: string[] }` on success; validation and DB failures use `{ error }` (never throws).
 */
export const getScanRemoteRepoValues = async (
    payload: GetScanRemoteRepoValuesPayload
): Promise<SupabaseResponse<string[]>> => {
    try {
        return await getScanRemoteRepoValuesValidated(payload);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return generateResponse.error(message) as SupabaseResponse<string[]>;
    }
};

const getScanRemoteRepoValuesValidated = validateWithSchema(
    getScanRemoteRepoValuesSchema,
    "getScanRemoteRepoValuesSchema"
)(async ({ usage }): Promise<SupabaseResponse<string[]>> => {
    try {
        const { data } = await scanTargetList<Repo>({
            category: CategoryRepo.REPO,
            selectFields: "value",
            orderBy: { field: "value", ascending: true },
            filterList: [{ field: REPO_USAGE_FIELD, operator: "eq", value: usage }],
        });

        const values = (data ?? [])
            .map((row) => row.value?.trim())
            .filter((value): value is string => value != null && value !== "");

        return generateResponse.success([...new Set(values)]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return generateResponse.error(message) as SupabaseResponse<string[]>;
    }
});
