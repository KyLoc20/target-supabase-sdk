import type { LoggerWithScope } from "../../shared/log";
import type { ReadinessCheck, ReadinessReport } from "./readiness.types";
import { runReadinessChecks } from "./run-readiness-checks";

export interface RunReadinessGateInput {
    checks: ReadinessCheck[];
    onReport: (report: ReadinessReport) => Promise<void>;
    logger: LoggerWithScope;
    logTopic?: string;
}

/** Run readiness checks, persist report via callback, fail-fast when not ok. */
export async function runReadinessGate(input: RunReadinessGateInput): Promise<ReadinessReport> {
    const { checks, onReport, logger, logTopic = "guard" } = input;

    logger.info("Running readiness checks", { topic: logTopic });
    const report = await runReadinessChecks(checks);
    await onReport(report);

    if (!report.ok) {
        logger.error("Readiness checks failed", {
            topic: logTopic,
            data: { message: report.message, checks: report.checks },
        });
        throw new Error(report.message ?? "Readiness checks failed");
    }

    logger.debug("Readiness checks passed", {
        topic: logTopic,
        data: { checks: report.checks.map((check) => check.name) },
    });

    return report;
}
