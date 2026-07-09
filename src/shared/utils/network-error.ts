export type NetworkErrorKind =
    | "connect_timeout"
    | "tls_disconnect"
    | "connection_refused"
    | "dns_error"
    | "socket_closed"
    | "timeout"
    | "proxy_error"
    | "unknown";

export interface ClassifiedNetworkError {
    kind: NetworkErrorKind;
    retryable: boolean;
    code: string;
    detail: string;
}

const RETRYABLE_CAUSE_CODES = new Set([
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EPIPE",
    "EAI_AGAIN",
]);

function errorCause(error: unknown): { code?: string; message?: string } | undefined {
    if (error instanceof Error) {
        return error.cause as { code?: string; message?: string } | undefined;
    }
    return undefined;
}

export function classifyNetworkError(error: unknown): ClassifiedNetworkError {
    if (!(error instanceof Error)) {
        return { kind: "unknown", retryable: false, code: "", detail: String(error) };
    }

    const cause = errorCause(error);
    const code = cause?.code ?? "";
    const causeMessage = cause?.message ?? "";
    const message = error.message;

    const tlsDisconnect =
        /TLS connection was established/i.test(causeMessage) ||
        /secure TLS connection/i.test(causeMessage) ||
        /socket disconnected before secure TLS/i.test(message) ||
        /socket disconnected before secure TLS/i.test(causeMessage);

    if (tlsDisconnect) {
        return {
            kind: "tls_disconnect",
            retryable: true,
            code,
            detail: causeMessage || message,
        };
    }

    if (code === "UND_ERR_CONNECT_TIMEOUT" || error.name === "TimeoutError" || error.name === "AbortError") {
        return {
            kind: error.name === "AbortError" ? "timeout" : "connect_timeout",
            retryable: true,
            code,
            detail: causeMessage || message,
        };
    }

    if (code === "ECONNREFUSED") {
        return {
            kind: "connection_refused",
            retryable: true,
            code,
            detail: causeMessage || message,
        };
    }

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return {
            kind: "dns_error",
            retryable: code === "EAI_AGAIN",
            code,
            detail: causeMessage || message,
        };
    }

    if (
        code === "UND_ERR_SOCKET" ||
        code === "ECONNRESET" ||
        code === "EPIPE" ||
        /socket disconnected/i.test(causeMessage) ||
        /other side closed/i.test(causeMessage)
    ) {
        return {
            kind: "socket_closed",
            retryable: true,
            code,
            detail: causeMessage || message,
        };
    }

    if (RETRYABLE_CAUSE_CODES.has(code)) {
        return {
            kind: "proxy_error",
            retryable: true,
            code,
            detail: causeMessage || message,
        };
    }

    return {
        kind: "unknown",
        retryable: false,
        code,
        detail: causeMessage ? `${message}: ${causeMessage}` : message,
    };
}

export interface FormatNetworkErrorOptions {
    /** Extra hint appended (proxy URL, env var name, etc.). */
    hint?: string;
}

export function formatNetworkError(error: unknown, label: string, options: FormatNetworkErrorOptions = {}): string {
    const classified = classifyNetworkError(error);
    const hint = options.hint ?? "";

    switch (classified.kind) {
        case "connect_timeout":
            return `${label}: connect timeout${hint}`;
        case "tls_disconnect":
            return `${label}: TLS handshake dropped${hint}. Often transient through proxies — retries may succeed.`;
        case "connection_refused":
            return `${label}: connection refused — ${classified.detail}${hint}`;
        case "dns_error":
            return `${label}: DNS lookup failed (${classified.code}) — ${classified.detail}`;
        case "socket_closed":
            return (
                `${label}: connection closed mid-request (${classified.code || "socket"}) — ` +
                `${classified.detail}${hint}`
            );
        case "timeout":
            return `${label}: request timeout — ${classified.detail}${hint}`;
        case "proxy_error":
            return `${label}: network/proxy error (${classified.code}) — ${classified.detail}${hint}`;
        default:
            return `${label}: ${classified.detail}${hint}`;
    }
}
