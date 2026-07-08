import { type TargetDraft } from "../core.interface";
import { sha256Hex } from "../shared/utils/sha256";
import { CategoryParcel, type Chunk, type Parcel, type ParcelCrypto, type ParcelDetails } from "./parcel.interface";

const MANIFEST_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB - fallback for empty input only
const MB = 1024 * 1024;
/** Source files at or below this size use at most 2 chunks */
const SMALL_FILE_MAX_BYTES = 50 * MB;
/** Target per-chunk size for larger files */
const PREFERRED_CHUNK_BYTES = 16 * MB;
/** Cap chunk count for very large files */
const MAX_CHUNK_COUNT = 64;
const AES_GCM_ALGORITHM = "AES-GCM-256";
const KEY_DERIVATION_PBKDF2 = "PBKDF2-SHA256";
const PBKDF2_ITERATIONS = 100_000;
const AES_GCM_IV_LENGTH = 12;
const AES_GCM_TAG_LENGTH = 128;
/** Auth tag bytes Web Crypto appends to AES-GCM ciphertext */
const AES_GCM_AUTH_TAG_BYTES = AES_GCM_TAG_LENGTH / 8;

/** @deprecated Legacy IV in Target.extra - read only for old parcels */
const LEGACY_EXTRA_IV_KEY = "iv";

/** Pluggable storage backend; chunks are round-robin distributed across adapters */
export interface StorageAdapter {
  /** Written to {@link Chunk.provider} (e.g. `"s3"`, `"ipfs"`) */
  provider?: string;
  upload(data: ArrayBuffer, pathOrKey: string): Promise<{ url: string }>;
}

export interface CreateOptions {
  /**
   * Bytes per chunk after split (plaintext or ciphertext).
   * When omitted, derived from source file size — see {@link resolveChunkSize}.
   */
  chunkSize?: number;
  /**
   * When `true`, encrypt the whole file before chunking.
   * Default `false` — plaintext shards across platforms (anti single-platform review).
   */
  encrypt?: boolean;
  /** User passphrase (e.g. `"apple"`); derives AES key via PBKDF2 when `encrypt` is true */
  passphrase?: string;
  /** Raw AES-GCM key; mutually exclusive with `passphrase` */
  key?: CryptoKey;
}

export interface ReassembleOptions {
  /** Raw AES-GCM key (parcels without passphrase-based KDF) */
  key?: CryptoKey;
  /** Passphrase when `details.crypto.keyDerivation` is PBKDF2 */
  passphrase?: string;
}

export interface CreateResult {
  details: ParcelDetails;
  /** Chunk payloads to upload (plaintext or ciphertext per `details.crypto`) */
  chunks: ArrayBuffer[];
  /** Present when `encrypt` and key was generated — caller must persist */
  key?: CryptoKey;
}

/** Identity fields for {@link save} — `id` / `created_at` come from {@link postParcel}. */
export interface ParcelSaveInput {
  name: string;
  value: string;
  tagList?: string[];
}

function getCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto) return globalThis.crypto;
  throw new Error("ParcelManager: crypto not available");
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function encrypt(data: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  return crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv), tagLength: AES_GCM_TAG_LENGTH },
    key,
    data
  );
}

async function decrypt(data: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv), tagLength: AES_GCM_TAG_LENGTH },
    key,
    data
  );
}

function isDecryptAuthFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "OperationError") {
    return true;
  }
  if (error instanceof Error) {
    return /operation failed|operation-specific|decrypt|OperationError/i.test(error.message);
  }
  return false;
}

async function decryptPayload(
  data: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array,
  usedPassphrase: boolean
): Promise<ArrayBuffer> {
  try {
    return await decrypt(data, key, iv);
  } catch (error) {
    if (isDecryptAuthFailure(error)) {
      throw new Error(
        usedPassphrase
          ? "ParcelManager.reassemble: 解密失败，口令错误或密文已损坏"
          : "ParcelManager.reassemble: 解密失败，密钥错误或密文已损坏"
      );
    }
    throw error;
  }
}

async function generateKey(): Promise<CryptoKey> {
  const crypto = getCrypto();
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const crypto = getCrypto();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function usesPassphraseDerivation(crypto: ParcelCrypto): boolean {
  return crypto.keyDerivation === KEY_DERIVATION_PBKDF2;
}

async function resolveDecryptionKey(crypto: ParcelCrypto, options: ReassembleOptions): Promise<CryptoKey> {
  if (usesPassphraseDerivation(crypto)) {
    if (options.passphrase == null || options.passphrase === "") {
      throw new Error("ParcelManager.reassemble: 口令加密 Parcel 需要提供 passphrase");
    }
    if (crypto.salt == null || crypto.salt === "") {
      throw new Error("ParcelManager.reassemble: 缺少 details.crypto.salt");
    }
    const iterations = crypto.pbkdf2Iterations ?? PBKDF2_ITERATIONS;
    const salt = base64ToBytes(crypto.salt);
    return deriveKeyFromPassphrase(options.passphrase, salt, iterations);
  }
  if (options.key != null) {
    return options.key;
  }
  throw new Error("ParcelManager.reassemble: 加密 Parcel 需要提供 key");
}

async function buildChunkList(
  payload: ArrayBuffer,
  chunkSize: number
): Promise<{ chunks: ArrayBuffer[]; chunkList: Chunk[] }> {
  const chunks: ArrayBuffer[] = [];
  const chunkList: Chunk[] = [];
  let offset = 0;
  let index = 0;

  while (offset < payload.byteLength) {
    const end = Math.min(offset + chunkSize, payload.byteLength);
    const chunkBuffer = payload.slice(offset, end);
    const checksum = await sha256Hex(chunkBuffer);
    chunks.push(chunkBuffer);
    chunkList.push({
      index,
      size: chunkBuffer.byteLength,
      checksum,
      url: "",
    });
    offset = end;
    index += 1;
  }

  return { chunks, chunkList };
}

/**
 * Derive per-chunk byte size from the buffer that will be split.
 *
 * | Payload size | Policy |
 * |--------------|--------|
 * | ≤50 MB | At most **2** chunks (`ceil(size / 2)` per chunk) |
 * | > 50 MB | Target ~16 MB per chunk; chunk count capped at **64** |
 *
 * For encrypted parcels, pass plaintext size + {@link AES_GCM_AUTH_TAG_BYTES}
 * (GCM auth tag is appended before split).
 *
 * Explicit `chunkSize` in {@link CreateOptions} overrides this table.
 */
function resolveChunkSize(fileSize: number, override?: number): number {
  if (override != null) {
    if (!Number.isFinite(override) || override <= 0) {
      throw new Error("ParcelManager.create: chunkSize must be a positive number");
    }
    return override;
  }
  if (fileSize <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }
  if (fileSize <= SMALL_FILE_MAX_BYTES) {
    return Math.ceil(fileSize / 2);
  }
  const targetChunks = Math.min(
    MAX_CHUNK_COUNT,
    Math.max(2, Math.ceil(fileSize / PREFERRED_CHUNK_BYTES))
  );
  return Math.ceil(fileSize / targetChunks);
}

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return merged.buffer;
}

function isEncryptionEnabled(details: ParcelDetails, parcelExtra?: string): boolean {
  if (details.crypto != null) {
    return details.crypto.enabled === true;
  }
  if (parcelExtra == null || parcelExtra.trim() === "") {
    return false;
  }
  try {
    const legacy = JSON.parse(parcelExtra) as Record<string, unknown>;
    return typeof legacy[LEGACY_EXTRA_IV_KEY] === "string";
  } catch {
    return false;
  }
}

function resolveCrypto(details: ParcelDetails, parcelExtra?: string): ParcelCrypto | null {
  if (details.crypto?.enabled === true) {
    return details.crypto;
  }
  if (parcelExtra == null || parcelExtra.trim() === "") {
    return null;
  }
  try {
    const legacy = JSON.parse(parcelExtra) as Record<string, unknown>;
    const iv = legacy[LEGACY_EXTRA_IV_KEY];
    if (typeof iv !== "string" || iv === "") {
      return null;
    }
    return { enabled: true, algorithm: AES_GCM_ALGORITHM, iv };
  } catch {
    return null;
  }
}

/**
 * Split a file into chunks. Default: plaintext shards; optional whole-file AES-GCM before split.
 */
async function create(file: ArrayBuffer, options: CreateOptions = {}): Promise<CreateResult> {
  const encryptEnabled = options.encrypt === true;
  const splitPayloadSize = encryptEnabled
    ? file.byteLength + AES_GCM_AUTH_TAG_BYTES
    : file.byteLength;
  const chunkSize = resolveChunkSize(splitPayloadSize, options.chunkSize);
  const plaintextChecksum = await sha256Hex(file);

  if (!encryptEnabled) {
    const { chunks, chunkList } = await buildChunkList(file, chunkSize);
    return {
      details: {
        manifestVersion: MANIFEST_VERSION,
        chunkList,
        checksum: plaintextChecksum,
        size: file.byteLength,
      },
      chunks,
    };
  }

  if (options.passphrase != null && options.key != null) {
    throw new Error("ParcelManager.create: passphrase 与 key 不能同時指定");
  }

  const cryptoApi = getCrypto();
  const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  let key: CryptoKey;
  let generatedKey = false;
  let cryptoMeta: ParcelCrypto;

  if (options.passphrase != null && options.passphrase !== "") {
    const salt = cryptoApi.getRandomValues(new Uint8Array(16));
    key = await deriveKeyFromPassphrase(options.passphrase, salt, PBKDF2_ITERATIONS);
    cryptoMeta = {
      enabled: true,
      algorithm: AES_GCM_ALGORITHM,
      iv: bytesToBase64(iv),
      keyDerivation: KEY_DERIVATION_PBKDF2,
      salt: bytesToBase64(salt),
      pbkdf2Iterations: PBKDF2_ITERATIONS,
    };
  } else if (options.key != null) {
    key = options.key;
    cryptoMeta = {
      enabled: true,
      algorithm: AES_GCM_ALGORITHM,
      iv: bytesToBase64(iv),
    };
  } else {
    key = await generateKey();
    generatedKey = true;
    cryptoMeta = {
      enabled: true,
      algorithm: AES_GCM_ALGORITHM,
      iv: bytesToBase64(iv),
    };
  }

  const encrypted = await encrypt(file, key, iv);
  const { chunks, chunkList } = await buildChunkList(encrypted, chunkSize);

  const result: CreateResult = {
    details: {
      manifestVersion: MANIFEST_VERSION,
      chunkList,
      checksum: plaintextChecksum,
      size: file.byteLength,
      crypto: cryptoMeta,
    },
    chunks,
  };
  if (generatedKey) {
    result.key = key;
  }
  return result;
}

/** Upload chunks round-robin across storage adapters */
async function save(
  createResult: CreateResult,
  fileSystems: StorageAdapter[],
  input: ParcelSaveInput
): Promise<TargetDraft<Parcel>> {
  if (fileSystems.length === 0) {
    throw new Error("ParcelManager.save: fileSystems 不能为空");
  }

  const { details, chunks } = createResult;
  const chunkListWithUrls: Chunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const adapter = fileSystems[i % fileSystems.length];
    const pathOrKey = `chunk-${i}-${details.checksum.slice(0, 8)}`;
    const { url } = await adapter.upload(chunks[i], pathOrKey);
    chunkListWithUrls.push({
      ...details.chunkList[i],
      url,
      provider: adapter.provider,
    });
  }

  return {
    name: input.name,
    value: input.value,
    tagList: input.tagList ?? [],
    category: CategoryParcel.PARCEL,
    details: {
      ...details,
      chunkList: chunkListWithUrls,
    },
  };
}

async function downloadAndVerifyChunks(chunkList: Chunk[]): Promise<ArrayBuffer[]> {
  const sortedChunks = [...chunkList].sort((a, b) => a.index - b.index);
  const buffers: ArrayBuffer[] = [];

  for (const chunkMeta of sortedChunks) {
    const res = await fetch(chunkMeta.url);
    if (!res.ok) {
      throw new Error(`ParcelManager.reassemble: 下载 chunk ${chunkMeta.index} 失败: ${res.status}`);
    }
    const chunkBuffer = await res.arrayBuffer();
    const chunkChecksum = await sha256Hex(chunkBuffer);
    if (chunkChecksum !== chunkMeta.checksum) {
      throw new Error(`ParcelManager.reassemble: chunk ${chunkMeta.index} 校验失败 (checksum 不一致`);
    }
    buffers.push(chunkBuffer);
  }

  return buffers;
}

function verifyPlaintextSize(buffer: ArrayBuffer, details: ParcelDetails): void {
  if (buffer.byteLength !== details.size) {
    throw new Error(
      `ParcelManager.reassemble: 重组后大小与 details.size 不一致(${buffer.byteLength} !== ${details.size})`
    );
  }
}

/**
 * Fetch chunks from {@link Parcel.details.chunkList}, reassemble, optionally decrypt, verify checksum.
 * Encrypted parcels: pass `{ passphrase }` for PBKDF2 parcels, or `{ key }` for raw-key parcels.
 */
async function reassemble(parcel: Parcel, options: ReassembleOptions = {}): Promise<ArrayBuffer> {
  const { details } = parcel;
  const encrypted = isEncryptionEnabled(details, parcel.extra);

  const buffers = await downloadAndVerifyChunks(details.chunkList);
  const merged = concatBuffers(buffers);

  if (!encrypted) {
    verifyPlaintextSize(merged, details);
    const fileChecksum = await sha256Hex(merged);
    if (fileChecksum !== details.checksum) {
      throw new Error("ParcelManager.reassemble: 重组后文件校验失败 (sha256 与 details.checksum 不一致)");
    }
    return merged;
  }

  const cryptoMeta = resolveCrypto(details, parcel.extra);
  if (cryptoMeta?.iv == null || cryptoMeta.iv === "") {
    throw new Error("ParcelManager.reassemble: 加密 Parcel 缺少 details.crypto.iv");
  }

  const iv = base64ToBytes(cryptoMeta.iv);
  if (iv.length !== AES_GCM_IV_LENGTH) {
    throw new Error("ParcelManager.reassemble: IV 长度无效");
  }

  const key = await resolveDecryptionKey(cryptoMeta, options);
  const usedPassphrase = usesPassphraseDerivation(cryptoMeta);
  const decrypted = await decryptPayload(merged, key, iv, usedPassphrase);
  verifyPlaintextSize(decrypted, details);
  const fileChecksum = await sha256Hex(decrypted);
  if (fileChecksum !== details.checksum) {
    throw new Error(
      usedPassphrase
        ? "ParcelManager.reassemble: 解密后校验失败，口令错误或数据已损坏"
        : "ParcelManager.reassemble: 解密后文件校验失败 (sha256 与 details.checksum 不一致)"
    );
  }

  return decrypted;
}

const ParcelManager = {
  create,
  save,
  reassemble,
};

export { ParcelManager };
