import { Target } from "../core.interface";
import { Lifecycle } from "./base.interface";

export interface Service extends Target {
  /** "storage-service" 唯一键 */
  value: string;
  category: CategoryService;
  details: ServiceDetails;
}

export enum CategoryService {
  SERVICE = "service",
}

export enum ServiceStatus {
  ACTIVE = "ACTIVE",
  DEPRECATED = "DEPRECATED",
  SUNSET = "SUNSET",
}

export interface ServiceDetails {
  /** 能力 Api keys */
  apis: string[];
  /** 依赖的服务 Service keys */
  dependencies: string[];
  lifecycle: Lifecycle;
}
