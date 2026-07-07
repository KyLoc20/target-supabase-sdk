export function resolveFetchUrl(input: string | URL | Request): string {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    return input.url;
}

export function isHttpUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
}
