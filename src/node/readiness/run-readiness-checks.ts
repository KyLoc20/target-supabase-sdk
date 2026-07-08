import type { ReadinessCheck, ReadinessReport } from "./readiness.types";

function formatFailureMessage(
    checks: ReadinessReport["checks"]
): string {
    return checks
        .filter((check) => !check.ok)
        .map((check) => `${check.name}: ${check.detail ?? "failed"}`)
        .join("; ");
}

/** Run checks in order and aggregate into a {@link ReadinessReport}. */
export async function runReadinessChecks(checks: ReadinessCheck[]): Promise<ReadinessReport> {
    const results = await Promise.all(checks.map((check) => check()));
    const failed = results.filter((check) => !check.ok);

    return {
        ok: failed.length === 0,
        checks: results,
        message: failed.length === 0 ? null : formatFailureMessage(results),
    };
}
