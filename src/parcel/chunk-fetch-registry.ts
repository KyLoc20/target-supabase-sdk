import { isHttpUrl, resolveFetchUrl } from "../shared/utils/fetch-url";
import { isLocalFilesystemPath, parseProviderPrefixedUrl } from "./chunk-url.utils";

interface ChunkResolver {
    provider: string;
    matches(url: string): boolean;
    resolve(locator: string): Promise<ArrayBuffer>;
}

/** Provider module subset used for opaque {@link Chunk} restore. */
export interface ChunkResolveProvider {
    readonly provider: string;
    resolveChunk?(locator: string): Promise<ArrayBuffer>;
    matchesOpaqueUrl?(url: string): boolean;
}

const resolvers = new Map<string, ChunkResolver>();

function registerChunkResolver(resolver: ChunkResolver): void {
    resolvers.set(resolver.provider, resolver);
}

/** Register a provider's chunk resolver (call when the provider module loads). */
export function registerProviderChunkResolver(module: ChunkResolveProvider): void {
    if (module.resolveChunk == null) {
        return;
    }

    const resolveChunk = module.resolveChunk;

    registerChunkResolver({
        provider: module.provider,
        matches(url: string) {
            const prefixed = parseProviderPrefixedUrl(url);
            if (prefixed != null) {
                return prefixed.provider === module.provider;
            }
            return module.matchesOpaqueUrl?.(url) === true;
        },
        resolve(locator: string) {
            const prefixed = parseProviderPrefixedUrl(locator);
            const opaque = prefixed?.provider === module.provider ? prefixed.locator : locator;
            return resolveChunk(opaque);
        },
    });
}

async function resolveOpaqueUrl(url: string): Promise<ArrayBuffer> {
    const prefixed = parseProviderPrefixedUrl(url);
    if (prefixed != null) {
        const resolver = resolvers.get(prefixed.provider);
        if (resolver == null) {
            throw new Error(`No chunk resolver registered for provider: ${prefixed.provider}`);
        }
        return resolver.resolve(prefixed.locator);
    }

    const matches = [...resolvers.values()].filter((entry) => entry.matches(url));
    if (matches.length === 1) {
        return matches[0].resolve(url);
    }
    if (matches.length > 1) {
        throw new Error(`Ambiguous chunk url (${url}); use provider-prefixed form e.g. telegram:${url.slice(0, 12)}…`);
    }

    const registered = [...resolvers.keys()].join(", ") || "(none)";
    throw new Error(`No chunk resolver for opaque url (${url.slice(0, 24)}…). Registered: ${registered}`);
}

/**
 * Patch global fetch so ParcelManager.reassemble can resolve opaque chunk locators.
 * HTTP URLs use the original fetch (S3 presigned, etc.).
 */
export function installChunkFetchRegistry(): () => void {
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = resolveFetchUrl(input);
        if (isHttpUrl(url)) {
            return originalFetch(input, init);
        }
        if (isLocalFilesystemPath(url)) {
            throw new Error(
                `Chunk fetch registry: local path not supported (${url}). ` +
                    "Use a local provider module or parcel-restore-local.",
            );
        }

        const buffer = await resolveOpaqueUrl(url);
        return new Response(buffer, { headers: { "Content-Type": "application/octet-stream" } });
    }) as typeof fetch;

    return () => {
        globalThis.fetch = originalFetch;
    };
}
