import type { LogEntry } from "../manager/telemetry-manager";
import type { CallEntry, TelemetryLane } from "../types";

export interface TelemetryLaneBufferState {
    entries: Array<LogEntry | CallEntry>;
    dropped: number;
    flushInFlight: boolean;
    lastFlushAt: number;
    oldestBufferedAt: number;
}

function createLaneState(): TelemetryLaneBufferState {
    return {
        entries: [],
        dropped: 0,
        flushInFlight: false,
        lastFlushAt: 0,
        oldestBufferedAt: 0,
    };
}

const lanes: Record<TelemetryLane, TelemetryLaneBufferState> = {
    log: createLaneState(),
    call: createLaneState(),
};

export function getTelemetryLaneBuffer(lane: TelemetryLane): TelemetryLaneBufferState {
    return lanes[lane];
}

export function appendTelemetryEntry(lane: TelemetryLane, entry: LogEntry | CallEntry, maxBuffer: number): void {
    const state = lanes[lane];
    if (state.entries.length === 0) {
        state.oldestBufferedAt = Date.now();
    }
    state.entries.push(entry);
    while (state.entries.length > maxBuffer) {
        state.entries.shift();
        state.dropped += 1;
    }
}

export function takeTelemetryLaneEntries(lane: TelemetryLane): {
    entries: Array<LogEntry | CallEntry>;
    dropped: number;
} {
    const state = lanes[lane];
    const entries = state.entries.splice(0, state.entries.length);
    const dropped = state.dropped;
    state.dropped = 0;
    state.oldestBufferedAt = 0;
    return { entries, dropped };
}

export function resetTelemetryBuffersForTests(): void {
    for (const lane of ["log", "call"] as const) {
        const state = lanes[lane];
        state.entries.length = 0;
        state.dropped = 0;
        state.flushInFlight = false;
        state.lastFlushAt = 0;
        state.oldestBufferedAt = 0;
    }
}
