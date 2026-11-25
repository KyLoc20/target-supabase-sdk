/**
 * Serial overview-probe helpers (heritage C).
 *
 * Do **not** fan out unbounded `Promise.all` of `getTargetTotalCount` / heavy scans in one
 * HTTP handler — that caused production `57014` statement timeouts on the shared `target` table.
 * Prefer: one probe per request, or strictly serial client fetches with per-row degrade.
 */

export interface OverviewProbeMeta {
    id: number;
    section: string;
    label: string;
}

export interface OverviewProbeError {
    code: string | null;
    message: string;
}

export interface OverviewProbeResult<TData = unknown> {
    id: number;
    section: string;
    label: string;
    ok: boolean;
    durationMs: number;
    data: TData | null;
    error: OverviewProbeError | null;
}

export interface RunOverviewProbeInput<TData> extends OverviewProbeMeta {
    run: () => Promise<TData>;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== "") {
        return error.message;
    }
    return String(error);
}

function errorCode(error: unknown): string | null {
    if (error != null && typeof error === "object" && "code" in error) {
        const code = (error as { code?: unknown }).code;
        return typeof code === "string" && code.trim() !== "" ? code : null;
    }
    return null;
}

/**
 * Run a single inventory probe; never throws — failures become `ok: false` in the result.
 */
export async function runOverviewProbe<TData>(
    input: RunOverviewProbeInput<TData>,
): Promise<OverviewProbeResult<TData>> {
    const started =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    try {
        const data = await input.run();
        const ended =
            typeof performance !== "undefined" && typeof performance.now === "function"
                ? performance.now()
                : Date.now();
        return {
            id: input.id,
            section: input.section,
            label: input.label,
            ok: true,
            durationMs: Math.round((ended - started) * 10) / 10,
            data,
            error: null,
        };
    } catch (error) {
        const ended =
            typeof performance !== "undefined" && typeof performance.now === "function"
                ? performance.now()
                : Date.now();
        return {
            id: input.id,
            section: input.section,
            label: input.label,
            ok: false,
            durationMs: Math.round((ended - started) * 10) / 10,
            data: null,
            error: {
                code: errorCode(error),
                message: errorMessage(error),
            },
        };
    }
}

/**
 * Run probes **strictly serially**. Prefer exposing one HTTP route per probe for large catalogs;
 * use this helper for scripts / small in-process inventories only.
 */
export async function runOverviewProbesSerial<TData>(
    probes: readonly RunOverviewProbeInput<TData>[],
): Promise<OverviewProbeResult<TData>[]> {
    const results: OverviewProbeResult<TData>[] = [];
    for (const probe of probes) {
        results.push(await runOverviewProbe(probe));
    }
    return results;
}
