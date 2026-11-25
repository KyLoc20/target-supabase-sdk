export interface MapWithConcurrencyOptions {
    signal?: AbortSignal;
}

/**
 * Run `fn` over `items` with bounded parallelism. Result order matches `items`.
 * When `signal` aborts, workers stop claiming new indexes (in-flight work still settles).
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
    options?: MapWithConcurrencyOptions,
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const workers = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (!options?.signal?.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                break;
            }
            results[index] = await fn(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));
    return results;
}
