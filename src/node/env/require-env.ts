export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
    const value = env[name]?.trim();
    if (value == null || value === "") {
        return undefined;
    }
    return value;
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
    const value = readEnv(name, env);
    if (value == null) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
