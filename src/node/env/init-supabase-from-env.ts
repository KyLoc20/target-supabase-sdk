import { supabase } from "../../supabase";
import { loadEnvFiles } from "./load-env";
import { readEnv, requireEnv } from "./require-env";

export interface InitSupabaseFromStandardEnvOptions {
    /** Project root for `.env` files (required when `loadEnv` is true). */
    root?: string;
    /** Load `.env.local` / `.env` before initialize (default true). */
    loadEnv?: boolean;
    /** Hook after env files loaded (legacy aliases, etc.). */
    afterLoadEnv?: () => void;
    env?: NodeJS.ProcessEnv;
}

/**
 * Load standard Supabase env vars and initialize the process-wide Supabase holder.
 *
 * Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
 * Optional: `SUPABASE_NEED_AUTH_URL`, `SUPABASE_NEED_AUTH_ANON_KEY`
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

    await supabase.initialize({
        supabaseUrl: requireEnv("SUPABASE_URL", env),
        supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY", env),
        supabaseNeedAuthUrl: readEnv("SUPABASE_NEED_AUTH_URL", env),
        supabaseNeedAuthAnonKey: readEnv("SUPABASE_NEED_AUTH_ANON_KEY", env),
    });
}
