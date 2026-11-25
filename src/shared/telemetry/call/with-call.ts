import type { SupabaseResponse } from "../../../core.interface";
import { runWithCallTransportContext } from "../transport/call-transport-context";
import { CALL_ERR_MESSAGE_MAX, CALL_EXTRA_MAX, CALL_RESULT_SUMMARY_MAX, type CallEntry } from "../types";
import { offerCallEntry } from "./offer";

function nowMark(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function clipCostMs(started: number): number {
    return Math.round((nowMark() - started) * 10) / 10;
}

export function truncateTelemetryText(value: string | null | undefined, max: number): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed === "") {
        return null;
    }
    return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function isSupabaseResponse(value: unknown): value is SupabaseResponse {
    return (
        value != null &&
        typeof value === "object" &&
        "success" in value &&
        typeof (value as SupabaseResponse).success === "boolean"
    );
}

function summarizeCallResult(result: unknown): { ok: boolean; resultSummary: string | null } {
    if (isSupabaseResponse(result)) {
        if (!result.success) {
            const code = result.error?.code?.trim();
            const msg = result.error?.message?.trim();
            const parts = ["success=false"];
            if (code) {
                parts.push(`code=${code}`);
            } else if (msg) {
                parts.push(`message=${msg.slice(0, 64)}`);
            }
            return {
                ok: false,
                resultSummary: truncateTelemetryText(parts.join(","), CALL_RESULT_SUMMARY_MAX),
            };
        }
        const data = result.data;
        if (typeof data === "number") {
            return { ok: true, resultSummary: truncateTelemetryText(`count=${data}`, CALL_RESULT_SUMMARY_MAX) };
        }
        if (Array.isArray(data)) {
            return {
                ok: true,
                resultSummary: truncateTelemetryText(`rows=${data.length}`, CALL_RESULT_SUMMARY_MAX),
            };
        }
        if (data != null && typeof data === "object" && "id" in data) {
            const id = String((data as { id: unknown }).id ?? "").trim();
            if (id) {
                return { ok: true, resultSummary: truncateTelemetryText(`id=${id}`, CALL_RESULT_SUMMARY_MAX) };
            }
        }
        return { ok: true, resultSummary: null };
    }
    return { ok: true, resultSummary: null };
}

function normalizeByteCount(value: number | null | undefined): number | null {
    if (value == null || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.floor(value);
}

function normalizeTransportStatus(value: number | null | undefined): number | null {
    if (value == null || !Number.isFinite(value)) {
        return null;
    }
    return Math.floor(value);
}

export type RecordCallInput = {
    op: string;
    ok: boolean;
    costMs: number;
    errMessage?: string | null;
    resultSummary?: string | null;
    module?: string | null;
    traceId?: string | null;
    extra?: string | null;
    transportStatus?: number | null;
    reqBytes?: number | null;
    respBytes?: number | null;
};

export function recordCall(partial: RecordCallInput): void {
    try {
        const entry: CallEntry = {
            ts: Date.now(),
            op: partial.op,
            ok: partial.ok,
            costMs: partial.costMs,
            errMessage: partial.ok ? null : truncateTelemetryText(partial.errMessage ?? null, CALL_ERR_MESSAGE_MAX),
            resultSummary: truncateTelemetryText(partial.resultSummary ?? null, CALL_RESULT_SUMMARY_MAX),
            module: truncateTelemetryText(partial.module ?? "core.api", 128),
            traceId: truncateTelemetryText(partial.traceId ?? null, 128),
            extra: truncateTelemetryText(partial.extra ?? null, CALL_EXTRA_MAX),
            transportStatus: normalizeTransportStatus(partial.transportStatus),
            reqBytes: normalizeByteCount(partial.reqBytes),
            respBytes: normalizeByteCount(partial.respBytes),
        };
        offerCallEntry(entry);
    } catch {
        // never affect caller
    }
}

/**
 * Wrap an async SDK API: record ok/costMs and Stage-A transport metrics from the
 * Supabase custom fetch (status + Content-Length) when Node ALS context is installed.
 */
export function withCallTelemetry<TArgs extends unknown[], TResult>(
    op: string,
    fn: (...args: TArgs) => Promise<TResult>,
    options?: {
        module?: string;
        extra?: string | null;
        /** Override fetch-derived metrics when provided. */
        transportStatus?: number | null;
        reqBytes?: number | null;
        respBytes?: number | null;
    },
): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
        const started = nowMark();
        const outcome = await runWithCallTransportContext(() => fn(...args));
        const transport = outcome.transport;

        if (outcome.ok) {
            const { ok, resultSummary } = summarizeCallResult(outcome.result);
            recordCall({
                op,
                ok,
                costMs: clipCostMs(started),
                resultSummary,
                module: options?.module ?? "core.api",
                extra: options?.extra ?? null,
                transportStatus:
                    options?.transportStatus !== undefined ? options.transportStatus : transport.transportStatus,
                reqBytes: options?.reqBytes !== undefined ? options.reqBytes : transport.reqBytes,
                respBytes: options?.respBytes !== undefined ? options.respBytes : transport.respBytes,
            });
            return outcome.result;
        }

        recordCall({
            op,
            ok: false,
            costMs: clipCostMs(started),
            errMessage: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
            module: options?.module ?? "core.api",
            extra: options?.extra ?? null,
            transportStatus:
                options?.transportStatus !== undefined ? options.transportStatus : transport.transportStatus,
            reqBytes: options?.reqBytes !== undefined ? options.reqBytes : transport.reqBytes,
            respBytes: options?.respBytes !== undefined ? options.respBytes : transport.respBytes,
        });
        throw outcome.error;
    };
}
