import type { Target } from "../core.interface";

export enum CategoryResource {
    RESOURCE = "resource",
}

export interface Resource extends Target {
    /** For now same to value */
    name: string;
    /** Unique id, "vultr:149.28.16.125" */
    value: string;
    category: CategoryResource;
    details: ResourceDetails;
}

export interface ResourceDetails {
    manifestVersion: 0;
    /**  "vultr-vps" | "supabase-project" | "telegram-storage" */
    loaderKey: string;
    meta: unknown;
    runtime: unknown;
}

// {
//     name: "windows-storage:DESKTOP-K32MS2Q",
//     value: "windows-storage:DESKTOP-K32MS2Q",
//     category: CategoryResource.RESOURCE,
//     tagList: [],
//     details: {
//       manifestVersion: 0,
//       loaderKey: "windows-storage",
//       meta: {
//         hostname: "DESKTOP-K32MS2Q",
//       },
//       runtime: {},
//     },
//   }
