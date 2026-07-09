import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load KEY=VALUE lines from `.env.local` / `.env` into `process.env` (does not override existing vars).
 */
export function loadEnvFiles(cwd = process.cwd()): void {
    for (const name of [".env.local", ".env"]) {
        const filePath = resolve(cwd, name);
        if (!existsSync(filePath)) {
            continue;
        }
        const content = readFileSync(filePath, "utf8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("#")) {
                continue;
            }
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) {
                continue;
            }
            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    }
}
