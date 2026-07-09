import type { Target } from "../core.interface";
import type { FieldDefinition, ServiceLifecycle } from "./base.interface";

export interface Service extends Target {
    name: string;
    /** "storage-service" 唯一键 */
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
