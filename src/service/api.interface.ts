import { Target } from "../core.interface";
import { Field, Lifecycle } from "./base.interface";

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
  request: {
    query: {
      [key: string]: Field;
    };
  };
  response: {
    "200": { [key: string]: Field };
  };
  manifestVersion: number;
  lifecycle: Lifecycle;
  /** TODO "application/octet-stream" */
  // contentType: string;
  /** TODO "application/json" */
  // responseType: string;
  /** TODO 安全模型/ 风控 / 限制 / 可观测性 & 审计 */
  // auth: unknown;
  // rate_limit: {
  //   key: "user_id";
  //   limit: 60;
  //   window: "1m";
  // };
}
