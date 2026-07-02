import { Target } from "../core.interface";
import { ServiceLifecycle } from "./base.interface";

export interface Service extends Target {
  name: string;
  /** "storage-service" 唯一键 */
  value: string;
  category: CategoryService;
  details: ServiceDetails;
}

export enum CategoryService {
  SERVICE = "service"
}

export interface ServiceDetails {
  manifestVersion: number;
  /** 能力 Api keys */
  apiKeys: string[];
  /** 依赖的服务 Service keys */
  dependencies: string[];
  lifecycle: ServiceLifecycle;
}
