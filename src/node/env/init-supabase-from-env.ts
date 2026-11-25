import { createSupabaseTelemetryFetch } from "../../shared/telemetry/transport/supabase-telemetry-fetch";
import { supabase } from "../../supabase";
import { loadEnvFiles } from "./load-env";
import { readEnv, requireEnv } from "./require-env";

export interface InitSupabaseFromStandardEnvOptions {
    /** Project root for `.env` files (required when `loadEnv` is true). */
    root?: string;
    /** Load env files before initialize (default true). Uses `.env.prod` when profile is `prod`. */
    loadEnv?: boolean;
    /** Hook after env files loaded (legacy aliases, etc.). */
    afterLoadEnv?: () => void;
    env?: NodeJS.ProcessEnv;
    /**
     * Install Stage-A telemetry fetch (status + Content-Length). Default true.
     * Set false for tests that need an untouched global fetch.
     */
    telemetryFetch?: boolean;
}

/**
 * Load standard Supabase env vars and initialize the process-wide Supabase holder.
 *
 * Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
 * Optional: `SUPABASE_NEED_AUTH_URL`, `SUPABASE_NEED_AUTH_ANON_KEY`
 *
 * Always passes a Node telemetry `fetch` wrapper unless `telemetryFetch: false`.
 */
export async function initSupabaseFromStandardEnv(options: InitSupabaseFromStandardEnvOptions = {}): Promise<void> {
    const env = options.env ?? process.env;
    const loadEnv = options.loadEnv ?? true;

    if (loadEnv) {
        if (options.root == null || options.root === "") {
            throw new Error("initSupabaseFromStandardEnv: root is required when loadEnv is true");
        }
        loadEnvFiles(options.root, { env, afterLoad: options.afterLoadEnv });
    }

    const useTelemetryFetch = options.telemetryFetch !== false;

    await supabase.initialize({
        supabaseUrl: requireEnv("SUPABASE_URL", env),
        supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY", env),
        supabaseNeedAuthUrl: readEnv("SUPABASE_NEED_AUTH_URL", env),
        supabaseNeedAuthAnonKey: readEnv("SUPABASE_NEED_AUTH_ANON_KEY", env),
        fetch: useTelemetryFetch ? createSupabaseTelemetryFetch(globalThis.fetch) : undefined,
    });
}
