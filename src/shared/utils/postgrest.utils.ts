/**
 * PostgREST / Supabase JS client helpers for `target` table filters.
 *
 * @see `.cursor/skills/postgrest-query-filters/SKILL.md`
 */

/**
 * Escape `%`, `_`, and `\` for PostgREST `ilike` patterns.
 * Also strips commas — they break `.or()` filter strings when multiple columns are searched.
 */
export function escapeIlikePattern(raw: string): string {
    return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/,/g, "");
}

/**
 * Format a JS string array as a PostgreSQL `text[]` literal for PostgREST filter values.
 *
 * Required when tag values contain `:` or other special characters, and when using
 * `.filter(column, "not.ov", literal)` — `.not("column", "ov", jsArray)` stringifies
 * with `Array#toString()` and produces an invalid array literal.
 *
 * @example
 * toPostgrestTextArrayLiteral(["stop-word:base", "small-word"])
 * // → '{"stop-word:base","small-word"}'
 */
export function toPostgrestTextArrayLiteral(values: readonly string[]): string {
    return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
