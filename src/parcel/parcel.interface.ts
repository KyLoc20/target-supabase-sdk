import { Target } from "../core.interface";

export interface Parcel extends Target {
  category: CategoryParcel;
  details: ParcelDetails;
}

export enum CategoryParcel {
  PARCEL = "parcel",
}

export interface ParcelDetails {
  manifestVersion: number;
  chunkList: Chunk[];
  /** sha256 */
  checksum: string;
  size: number;
}

export enum LifecycleStatus {
  STORED = "STORED",
  SOFT_DELETED = "SOFT_DELETED",
  HARD_DELETED = "HARD_DELETED",
}

export interface Lifecycle {
  status: LifecycleStatus;
  storedAt: string;
  softDeletedAt: string | null;
  hardDeletedAt: string | null;
}

export interface Chunk {
  index: number;
  /** TODO Storage service provider */
  // shardKey: string;
  size: number;
  checksum: string;
  url: string;
}
