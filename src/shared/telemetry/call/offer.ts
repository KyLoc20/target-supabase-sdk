import type { LogEntry } from "../manager/telemetry-manager";
import type { CallEntry } from "../types";

type LogOffer = (entry: LogEntry) => void;
type CallOffer = (entry: CallEntry) => void;

let logOffer: LogOffer | null = null;
let callOffer: CallOffer | null = null;

export function registerTelemetryLogOffer(fn: LogOffer | null): void {
    logOffer = fn;
}

export function registerTelemetryCallOffer(fn: CallOffer | null): void {
    callOffer = fn;
}

export function offerLogEntry(entry: LogEntry): void {
    try {
        logOffer?.(entry);
    } catch {
        // best-effort
    }
}

export function offerCallEntry(entry: CallEntry): void {
    try {
        callOffer?.(entry);
    } catch {
        // best-effort
    }
}
