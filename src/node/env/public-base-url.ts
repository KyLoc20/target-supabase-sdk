import { readEnv } from "./require-env";

export interface PublicBaseUrlFromEnvOptions {
    /** Env var for public URL override (e.g. `STORAGE_PUBLIC_URL`). */
    envKey: string;
    env?: NodeJS.ProcessEnv;
}

/**
 * Public base URL: `envKey` if set (trailing slash stripped), else `http://localhost:{port}`.
 */
export function publicBaseUrlFromEnv(
    port: number,
    options: PublicBaseUrlFromEnvOptions
): string {
    const configured = readEnv(options.envKey, options.env ?? process.env);
    if (configured != null) {
        return configured.replace(/\/$/, "");
    }
    return `http://localhost:${port}`;
}
