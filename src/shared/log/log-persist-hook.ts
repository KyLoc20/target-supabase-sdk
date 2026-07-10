import type { LogEntry } from "./log-manager";

type LogPersistOfferFn = (entry: LogEntry) => void;

let offerFn: LogPersistOfferFn | null = null;

export function registerLogPersistOffer(fn: LogPersistOfferFn | null): void {
    offerFn = fn;
}

export function offerToLogPersist(entry: LogEntry): void {
    offerFn?.(entry);
}
