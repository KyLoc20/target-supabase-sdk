/**
 * Correlates Supabase `fetch` observations with {@link withCallTelemetry}.
 * Default impl is a no-op (browser / before Node install).
 * Node installs ALS via `./call-transport-context-node` (imported from `/node` entry).
 */

export interface CallTransportSnapshot {
    /** Last (or most severe) HTTP status observed in this call scope. */
    transportStatus: number | null;
    /** Sum of request `Content-Length` values that were present; `null` if none. */
    reqBytes: number | null;
    /** Sum of response `Content-Length` values that were present; `null` if none. */
    respBytes: number | null;
    /** How many HTTP round-trips were observed. */
    fetchCount: number;
}

export interface CallTransportObservation {
    transportStatus: number;
    reqBytes: number | null;
    respBytes: number | null;
}

export interface CallTransportStore {
    lastStatus: number | null;
    non2xxStatus: number | null;
    reqBytesSum: number;
    respBytesSum: number;
    reqSamples: number;
    respSamples: number;
    fetchCount: number;
}

export interface CallTransportContextImpl {
    run<T>(store: CallTransportStore, fn: () => Promise<T>): Promise<T>;
    getStore(): CallTransportStore | undefined;
}

function createEmptyStore(): CallTransportStore {
    return {
        lastStatus: null,
        non2xxStatus: null,
        reqBytesSum: 0,
        respBytesSum: 0,
        reqSamples: 0,
        respSamples: 0,
        fetchCount: 0,
    };
}

const noopImpl: CallTransportContextImpl = {
    async run(_store, fn) {
        return fn();
    },
    getStore() {
        return undefined;
    },
};

let impl: CallTransportContextImpl = noopImpl;

/** Installed once from Node entry — do not call from browser bundles. */
export function installCallTransportContextImpl(next: CallTransportContextImpl): void {
    impl = next;
}

export function accumulateCallTransport(observation: CallTransportObservation): void {
    try {
        const store = impl.getStore();
        if (store == null) {
            return;
        }
        store.fetchCount += 1;
        store.lastStatus = observation.transportStatus;
        if (observation.transportStatus < 200 || observation.transportStatus >= 300) {
            store.non2xxStatus = observation.transportStatus;
        }
        if (observation.reqBytes != null) {
            store.reqBytesSum += observation.reqBytes;
            store.reqSamples += 1;
        }
        if (observation.respBytes != null) {
            store.respBytesSum += observation.respBytes;
            store.respSamples += 1;
        }
    } catch {
        // never affect fetch
    }
}

export function snapshotCallTransport(store: CallTransportStore): CallTransportSnapshot {
    return {
        transportStatus: store.non2xxStatus ?? store.lastStatus,
        reqBytes: store.reqSamples > 0 ? store.reqBytesSum : null,
        respBytes: store.respSamples > 0 ? store.respBytesSum : null,
        fetchCount: store.fetchCount,
    };
}

export async function runWithCallTransportContext<T>(
    fn: () => Promise<T>,
): Promise<
    | { ok: true; result: T; transport: CallTransportSnapshot }
    | { ok: false; error: unknown; transport: CallTransportSnapshot }
> {
    const store = createEmptyStore();
    try {
        const result = await impl.run(store, fn);
        return { ok: true, result, transport: snapshotCallTransport(store) };
    } catch (error) {
        return { ok: false, error, transport: snapshotCallTransport(store) };
    }
}
