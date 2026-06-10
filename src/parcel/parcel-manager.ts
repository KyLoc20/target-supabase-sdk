import type { Chunk, Parcel, ParcelDetails } from "./parcel.interface";

const MANIFEST_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256KB
const AES_GCM_IV_LENGTH = 12;
const AES_GCM_TAG_LENGTH = 128;

/** IV 存在 Parcel.extra 中的 JSON 键 */
const EXTRA_IV_KEY = "iv";

/** 可插拔的存储适配器：不同文件系统 */
export interface StorageAdapter {
  /** 上传一段数据，返回可下载的 URL */
  upload(data: ArrayBuffer, pathOrKey: string): Promise<{ url: string }>;
}

interface CreateOptions {
  /** 每个 chunk 的字节数，默认 256KB */
  chunkSize?: number;
  /** AES-GCM 加密密钥；不传则生成并返回 */
  key?: CryptoKey;
}

interface CreateResult {
  /** 元数据，chunk 的 url 由 save 填充 */
  details: ParcelDetails;
  /** 已加密的 chunk 数据，供 save 上传 */
  chunks: ArrayBuffer[];
  /** Base64 编码的 IV，需在 save 时写入 Parcel.extra 供 reassembly 使用 */
  ivBase64: string;
  /** 若 create 时未传 key，则返回此处，调用方需妥善保存 */
  key?: CryptoKey;
}

/** 调用方提供的 Target 基础字段，用于拼成完整 Parcel */
export type ParcelTargetBase = Pick<Parcel, "id" | "category" | "name" | "value" | "tagList" | "created_at">;

function getCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto) return globalThis.crypto;
  throw new Error("ParcelManager: crypto not available");
}

/** 计算 ArrayBuffer 的 SHA-256，返回 hex 字符串 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const crypto = getCrypto();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** AES-GCM 加密 */
async function encrypt(data: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  const ivCopy = new Uint8Array(iv);
  return crypto.subtle.encrypt({ name: "AES-GCM", iv: ivCopy, tagLength: AES_GCM_TAG_LENGTH }, key, data);
}

/** AES-GCM 解密 */
async function decrypt(data: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  const ivCopy = new Uint8Array(iv);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: ivCopy, tagLength: AES_GCM_TAG_LENGTH }, key, data);
}

/** 生成 AES-GCM 密钥（256 位） */
async function generateKey(): Promise<CryptoKey> {
  const crypto = getCrypto();
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** 将文件加密后拆分成多个 chunk */
async function create(file: ArrayBuffer, options: CreateOptions = {}): Promise<CreateResult> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  let key = options.key;
  const generatedKey = !key;
  if (!key) key = await generateKey();

  const crypto = getCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));

  const encrypted = await encrypt(file, key, iv);
  const totalSize = encrypted.byteLength;

  const chunks: ArrayBuffer[] = [];
  const chunkList: Chunk[] = [];
  let offset = 0;
  let index = 0;

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const chunkBuffer = encrypted.slice(offset, end);
    chunks.push(chunkBuffer);
    const checksum = await sha256Hex(chunkBuffer);
    chunkList.push({
      index,
      size: chunkBuffer.byteLength,
      checksum,
      url: "", // 由 save 填充
    });
    offset = end;
    index += 1;
  }

  const checksum = await sha256Hex(file);

  const details: ParcelDetails = {
    manifestVersion: MANIFEST_VERSION,
    chunkList: chunkList,
    checksum,
    size: file.byteLength,
  };

  const result: CreateResult = {
    details,
    chunks,
    ivBase64: btoa(String.fromCharCode(...iv)),
  };
  if (generatedKey) result.key = key;
  return result;
}

/** 将 chunk 均匀分布到不同文件系统并存储 */
async function save(
  createResult: CreateResult,
  fileSystems: StorageAdapter[],
  targetBase: ParcelTargetBase
): Promise<Parcel> {
  if (fileSystems.length === 0) throw new Error("ParcelManager.save: fileSystems 不能为空");
  const { details, chunks, ivBase64 } = createResult;

  const chunkListWithUrls: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const fs = fileSystems[i % fileSystems.length];
    const pathOrKey = `chunk-${i}-${details.checksum.slice(0, 8)}`;
    const { url } = await fs.upload(chunks[i], pathOrKey);
    chunkListWithUrls.push({ ...details.chunkList[i], url });
  }

  const extra = JSON.stringify({ [EXTRA_IV_KEY]: ivBase64 });

  return {
    ...targetBase,
    category: "parcel" as Parcel["category"],
    details: {
      ...details,
      chunkList: chunkListWithUrls,
    },
    extra,
  };
}

/** 根据 Parcel 下载各 chunk，重组并校验后返回原文件 */
async function reassembly(parcel: Parcel, key: CryptoKey): Promise<ArrayBuffer> {
  const { details } = parcel;
  let ivBase64: string | undefined;
  try {
    const extra = parcel.extra ? JSON.parse(parcel.extra) : {};
    ivBase64 = extra[EXTRA_IV_KEY];
  } catch {
    throw new Error("ParcelManager.reassembly: 无法从 extra 解析 IV");
  }
  if (!ivBase64 || typeof ivBase64 !== "string") {
    throw new Error("ParcelManager.reassembly: Parcel.extra 中缺少 iv");
  }

  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  if (iv.length !== AES_GCM_IV_LENGTH) {
    throw new Error("ParcelManager.reassembly: IV 长度无效");
  }

  const sortedChunks = [...details.chunkList].sort((a, b) => a.index - b.index);
  const buffers: ArrayBuffer[] = [];

  for (const chunkMeta of sortedChunks) {
    const res = await fetch(chunkMeta.url);
    if (!res.ok) throw new Error(`ParcelManager.reassembly: 下载 chunk ${chunkMeta.index} 失败: ${res.status}`);
    const chunkBuffer = await res.arrayBuffer();
    const chunkChecksum = await sha256Hex(chunkBuffer);
    if (chunkChecksum !== chunkMeta.checksum) {
      throw new Error(`ParcelManager.reassembly: chunk ${chunkMeta.index} 校验失败 (checksum 不一致)`);
    }
    buffers.push(chunkBuffer);
  }

  const totalEncryptedLength = buffers.reduce((s, b) => s + b.byteLength, 0);
  const encrypted = new Uint8Array(totalEncryptedLength);
  let offset = 0;
  for (const b of buffers) {
    encrypted.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  const decrypted = await decrypt(encrypted.buffer, key, iv);
  const fileChecksum = await sha256Hex(decrypted);
  if (fileChecksum !== details.checksum) {
    throw new Error("ParcelManager.reassembly: 重组后文件校验失败 (sha256 与 details.checksum 不一致)");
  }

  return decrypted;
}

const ParcelManager = {
  create,
  save,
  reassembly,
};

export default ParcelManager;
