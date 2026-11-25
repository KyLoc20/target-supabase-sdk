import { accumulateCallTransport } from "./call-transport-context";

type FetchLike = typeof globalThis.fetch;

function parseContentLength(headers: Headers): number | null {
    const raw = headers.get("content-length");
    if (raw == null || raw.trim() === "") {
        return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
        return null;
    }
    return Math.floor(n);
}

function requestContentLength(input: RequestInfo | URL, init?: RequestInit): number | null {
    try {
        if (init?.headers != null) {
            const fromInit = parseContentLength(new Headers(init.headers));
            if (fromInit != null) {
                return fromInit;
            }
        }
        if (typeof Request !== "undefined" && input instanceof Request) {
            return parseContentLength(input.headers);
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * Stage A: wrap `fetch` for Supabase clients — record status + Content-Length only.
 * Does **not** clone or read the body.
 */
export function createSupabaseTelemetryFetch(baseFetch: FetchLike = globalThis.fetch): FetchLike {
    const fetchFn = baseFetch.bind(globalThis);

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const reqBytes = requestContentLength(input, init);
        const response = await fetchFn(input, init);
        try {
            accumulateCallTransport({
                transportStatus: response.status,
                reqBytes,
                respBytes: parseContentLength(response.headers),
            });
        } catch {
            // never affect supabase-js
        }
        return response;
    };
}
