import type { Target } from "../core.interface";

export interface Config extends Target {
    /** Human readable name */
    name: string;
    /** Unique key (e.g. system registry Config value) */
    value: string;
    category: CategoryConfig;
    details: ConfigDetails;
}

export enum CategoryConfig {
    CONFIG = "config",
}

export interface ConfigDetails {
    manifestVersion: number;
    /** How to resolve the Config */
    loaderKey: string;
    meta: unknown;
    objects: Array<unknown>;
}
