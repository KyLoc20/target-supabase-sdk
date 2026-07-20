/** Read a dotted path (e.g. `data.items`) from a parsed JSON value. */
export function getValueAtPath(value: unknown, path: string | null | undefined): unknown {
    if (path == null || path.trim() === "") {
        return value;
    }
    let current: unknown = value;
    for (const segment of path.split(".")) {
        if (segment === "") {
            continue;
        }
        if (current == null || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}
