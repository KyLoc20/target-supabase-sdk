import type { Target } from "../core.interface";
import type { NodeStatus } from "../node/node.interface";
import type { FieldDefinition, ServiceLifecycle } from "./base.interface";

export interface Service extends Target {
    name: string;
    /**
     * Logical service key (e.g. `watch-service`). **Not unique** — each `postService` creates
     * a new instance row. Which instance is **available** is determined by registry slots
     * (`getTargetSystemRegistry` / `resolveActiveRegistryServiceId`), not by `getService({ value })`.
     */
    value: string;
    category: CategoryService;
    details: ServiceDetails;
}

export enum CategoryService {
    SERVICE = "service",
}

export interface ServiceDetails {
    manifestVersion: number;
    /** 能力 Api keys */
    apiKeys: string[];
    /** 依赖的服务 Service keys */
    dependencies: string[];
    lifecycle: ServiceLifecycle;
    /** Present on runtime instances; omitted on catalog-only rows until guard starts. */
    runtime?: ServiceRuntime;
}

/** Per-node snapshot under a running Service — maintained by the service guard. */
export interface ServiceNodeSnapshot {
    nodeId: string;
    status: NodeStatus;
    lastHeartBeat: number;
}

/**
 * Runtime observability for a registered Service instance.
 * Heartbeat and node rollups are written by the service guard, not the system registry Config.
 */
export interface ServiceRuntime {
    lastHeartBeat: number;
    nodes: ServiceNodeSnapshot[];
}

export enum ServiceSlotStatus {
    EMPTY = "EMPTY",
    ACTIVE = "ACTIVE",
}

export interface ServiceSlot {
    serviceValue: string;
    /** Bound {@link Service.id} when {@link ServiceSlotStatus.ACTIVE}; null when EMPTY. */
    serviceId: string | null;
    status: ServiceSlotStatus;
}

export interface Api extends Target {
    /** "core.post.target.0" 唯一键 领域 + METHOD + content + VERSION */
    value: string;
    category: CategoryApi;
    details: ApiDetails;
}

export enum CategoryApi {
    API = "api",
}

export enum ApiMethod {
    POST = "POST",
    GET = "GET",
    PUT = "PUT",
    DELETE = "DELETE",
}

export interface ApiDetails {
    method: ApiMethod;
    /** /v0/core/target */
    path: string;
    /** out-of-box url like https://api.example.com/v0/core/target */
    endpoint: string;
    request: {
        query: FieldDefinition[];
    };
    response: {
        "200": FieldDefinition[];
    };
    manifestVersion: number;
    lifecycle: ServiceLifecycle;
    /** TODO contentType: e.g. application/json | application/octet-stream */
    /** TODO auth / rate_limit / observability */
}
