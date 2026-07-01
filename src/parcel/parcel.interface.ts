import { Target } from "../core.interface";

export enum CategoryParcel {
  PARCEL = "parcel",
}

export interface Parcel extends Target {
  /** Human readable name */
  name: string;
  /** Used to search the parcel, should be unique */
  value: string;
  category: CategoryParcel;
  details: ParcelDetails;
}

export interface ParcelCrypto {
  /** 未設置或 false → 明文分片 */
  enabled: boolean;
  /** 例如 "AES-GCM-256"；enabled 時必填 */
  algorithm?: string;
  /** Base64 IV；AES-GCM 時必填 */
  iv?: string;
  /** 口令派生密鑰時的 KDF，例如 "PBKDF2-SHA256" */
  keyDerivation?: string;
  /** PBKDF2 salt（Base64）；keyDerivation 為 PBKDF2 時必填 */
  salt?: string;
  /** PBKDF2 迭代次數；未設置時由 SDK 默認 */
  pbkdf2Iterations?: number;
}

export interface ParcelDetails {
  manifestVersion: number;
  chunkList: Chunk[];
  /** 還原後的明文 sha256 */
  checksum: string;
  /** 還原後的明文大小（字節） */
  size: number;
  preview?: string;
  crypto?: ParcelCrypto;
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
  size: number;
  checksum: string;   // 該 chunk 字節的 sha256（明文或密文，與 create 時一致）
  url: string;
  provider?: string;  // 對應 StorageAdapter / 平台標識（呼應 TODO shardKey）
}
