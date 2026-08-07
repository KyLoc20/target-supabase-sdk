/** Per-file write queue — serializes read-modify-write for a single JSON path within one process. */
const writeChains = new Map<string, Promise<unknown>>();

export function withSerializedFileWrites<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = writeChains.get(filePath) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    writeChains.set(
        filePath,
        next.then(
            () => undefined,
            () => undefined,
        ),
    );
    return next;
}
