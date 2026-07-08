import { registerProviderChunkResolver } from "./chunk-fetch-registry";
import type { ProviderProbeResult, StorageProviderModule } from "./storage-provider.types";

export type ProviderProbeMap = Record<string, ProviderProbeResult | { ok: true; detail: { skipped: true } }>;

export interface StorageProviderRegistry {
    register(module: StorageProviderModule): void;
    get(provider: string): StorageProviderModule;
    has(provider: string): boolean;
    list(): string[];
    probeAll(): Promise<ProviderProbeMap>;
}

/** In-process registry for {@link StorageProviderModule}; syncs chunk resolvers on register. */
export function createStorageProviderRegistry(): StorageProviderRegistry {
    const modules = new Map<string, StorageProviderModule>();

    return {
        register(module) {
            modules.set(module.provider, module);
            registerProviderChunkResolver(module);
        },
        get(provider) {
            const found = modules.get(provider);
            if (found == null) {
                const available = [...modules.keys()].join(", ") || "(none)";
                throw new Error(`Unknown storage provider: ${provider}. Registered: ${available}`);
            }
            return found;
        },
        has(provider) {
            return modules.has(provider);
        },
        list() {
            return [...modules.keys()];
        },
        async probeAll() {
            const out: ProviderProbeMap = {};
            for (const [name, module] of modules) {
                if (module.probe == null) {
                    out[name] = { ok: true, detail: { skipped: true } };
                    continue;
                }
                out[name] = await module.probe();
            }
            return out;
        },
    };
}
