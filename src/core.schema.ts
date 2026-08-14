import { type ZodError, type ZodType, z } from "zod";
import type { QueryFilter } from "./core.interface";

/** {@link QueryFilter} — shared by createTarget redundancy checks and message payloads. */
export const queryFilterSchema = z
    .object({
        field: z.string().trim().min(1),
        operator: z.enum(["eq", "neq", "in"]),
        value: z.any(),
    })
    .transform(
        (row): QueryFilter => ({
            field: row.field,
            operator: row.operator,
            value: row.value,
        }),
    );

/** Persisted Target create/patch body (no `id` / `created_at`). */
export const postTargetPayloadSchema = z.object({
    name: z.string(),
    value: z.string(),
    category: z.string(),
    tagList: z.array(z.string()),
    extra: z.string().optional(),
    details: z.unknown().optional(),
});

export type PostTargetPayload = z.infer<typeof postTargetPayloadSchema>;

/** {@link TargetDraft} — stricter trim on identity fields for draft/message boundaries. */
export const targetDraftSchema = postTargetPayloadSchema.extend({
    name: z.string().trim().min(1),
    value: z.string().trim().min(1),
    category: z.string().trim().min(1),
});

export function formatZodError(error: ZodError): string {
    return error.issues.map((issue) => issue.message).join("; ");
}

export function safeParseWithSchema<T extends ZodType>(
    schema: T,
    input: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
    const result = schema.safeParse(input);
    if (!result.success) {
        return { ok: false, error: formatZodError(result.error) };
    }
    return { ok: true, data: result.data };
}
