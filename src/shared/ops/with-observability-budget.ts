/** Default wall-clock budget for optional DB/IO probes inside observability handlers. */
export const DEFAULT_OBSERVABILITY_BUDGET_MS = 4_000;

/**
 * Race `promise` against a wall-clock budget.
 *
 * On timeout or rejection returns `null` (never throws). Use for observability
 * paths that must not stretch past Docker/gateway healthcheck windows.
 * Process `/health` handlers should avoid calling this with DB work at all.
 */
export async function withObservabilityBudget<T>(
    promise: Promise<T>,
    budgetMs: number = DEFAULT_OBSERVABILITY_BUDGET_MS,
): Promise<T | null> {
    const ms = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : DEFAULT_OBSERVABILITY_BUDGET_MS;
    try {
        return await Promise.race([
            promise,
            new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), ms);
            }),
        ]);
    } catch {
        return null;
    }
}
