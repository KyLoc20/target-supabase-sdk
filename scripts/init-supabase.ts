import { supabase } from "../src/supabase.js";
import { loadEnvFiles } from "./load-env.js";

export function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (value == null || value === "") {
        throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
    }
    return value;
}

/** Load `.env.local` / `.env` and initialize Supabase clients. */
export async function initSupabaseFromEnv(projectRoot: string): Promise<void> {
    loadEnvFiles(projectRoot);

    await supabase.initialize({
        supabaseUrl: requireEnv("SUPABASE_URL"),
        supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY"),
        supabaseNeedAuthUrl: process.env.SUPABASE_NEED_AUTH_URL,
        supabaseNeedAuthAnonKey: process.env.SUPABASE_NEED_AUTH_ANON_KEY,
    });
}
