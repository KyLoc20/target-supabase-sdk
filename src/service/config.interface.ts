import type { Target } from "../core.interface";

export interface Config extends Target {
    /** Human readable name */
    name: string;
    /** Unique key, like TARGET_SYSTEM_REGISTRY_KEY */
    value: string;
    category: CategoryConfig;
    details: ConfigDetails;
}

export enum CategoryConfig {
    CONFIG = "config",
}

/** Globally unique Config key for the declarative system service registry. */
export const TARGET_SYSTEM_REGISTRY_KEY = "target-system-registry";

export interface ConfigDetails {
    manifestVersion: number;
    /** How to resolve the Config */
    loaderKey: string;
    meta: unknown;
    objects: Array<unknown>;
}
