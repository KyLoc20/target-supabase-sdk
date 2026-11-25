/**
 * Ops heritage helpers extracted from log-service / L3 lessons (excluding list decode scan A).
 * Callers are not wired yet — import explicitly when adopting.
 */

export type { ClassifyStalePrefixOptions } from "./classify-stale-prefix";
export {
    classifyStalePrefix,
    isCreatedAtStale,
    parseCreatedAtMs,
} from "./classify-stale-prefix";
export type { GetLatestTargetInput } from "./get-latest-target";
export { getLatestTarget } from "./get-latest-target";
export type { MapWithConcurrencyOptions } from "./map-with-concurrency";
export { mapWithConcurrency } from "./map-with-concurrency";
export type {
    OverviewProbeError,
    OverviewProbeMeta,
    OverviewProbeResult,
    RunOverviewProbeInput,
} from "./overview-probe";
export { runOverviewProbe, runOverviewProbesSerial } from "./overview-probe";
export {
    DEFAULT_OBSERVABILITY_BUDGET_MS,
    withObservabilityBudget,
} from "./with-observability-budget";
