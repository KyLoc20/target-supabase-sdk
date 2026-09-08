/**
 * Config domain public API — curated re-exports only.
 * System registry seed / claim APIs live in `src/service/registry/`.
 */

export type { GetConfigPayload } from "./config.api";
export { getConfig, getConfigSchema } from "./config.api";
export type { Config, ConfigDetails } from "./config.interface";
export { CategoryConfig } from "./config.interface";
