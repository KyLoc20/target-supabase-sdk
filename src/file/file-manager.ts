import type { FileDetails, FilePreview } from "./file.interface";

const FILE_MANIFEST_VERSION = 1;
const PREVIEW_MANIFEST_VERSION = 1;

export class FileManagerError extends Error {
    constructor(
        message: string,
        cause?: unknown
    ) {
        super(message, { cause });
        this.name = "FileManagerError";
    }
}

export interface CreatePreviewProps {
    refTargetId: string;
}

function createPreviewV0(props: CreatePreviewProps): FilePreview {
    return {
        manifestVersion: PREVIEW_MANIFEST_VERSION,
        refTargetId: props.refTargetId,
    };
}

export interface CreateFileProps {
    manifestVersion: 0
    /** "abc.1" */
    value: string;
    filePath: string;
    needParcel: boolean;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
    try {
        const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
        const bytes = new Uint8Array(hashBuffer);
        return Array.from(bytes)
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    } catch (error) {
        throw new FileManagerError("FileManager.sha256Hex: 計算文件 hash 失敗", error);
    }
}

function isLikelyLocalPath(path: string): boolean {
    // Windows: C:\foo\bar.txt / \\server\share ; POSIX absolute: /foo/bar
    return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function isFetchableResource(path: string): boolean {
    return /^(https?:|blob:|data:)/.test(path) || path.startsWith("./") || path.startsWith("../");
}

function getBaseName(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? "unknown";
}

async function readLocalFileByPicker(filePath: string): Promise<ArrayBuffer> {
    try {
        if (!("showOpenFilePicker" in globalThis) || typeof globalThis.showOpenFilePicker !== "function") {
            throw new FileManagerError(
                "FileManager.readLocalFileByPicker: 當前瀏覽器不支持 File System Access API",
                { filePath }
            );
        }

        const [handle] = await globalThis.showOpenFilePicker({
            multiple: false,
        });
        const file = await handle.getFile();
        const expectedName = getBaseName(filePath);
        if (expectedName !== "unknown" && file.name !== expectedName) {
            throw new FileManagerError(
                "FileManager.readLocalFileByPicker: 選擇的文件與目標路徑不一致",
                { expectedName, actualName: file.name, filePath }
            );
        }
        return file.arrayBuffer();
    } catch (error) {
        throw new FileManagerError("FileManager.readLocalFileByPicker: 本地文件讀取失敗", error);
    }
}

async function readFileBufferFromPath(filePath: string): Promise<ArrayBuffer> {
    try {
        if (isLikelyLocalPath(filePath) && !isFetchableResource(filePath)) {
            return readLocalFileByPicker(filePath);
        }

        const response = await fetch(filePath);
        if (!response.ok) {
            throw new FileManagerError(
                `FileManager.readFileBufferFromPath: 無法讀取文件內容 (${response.status})`,
                { status: response.status, statusText: response.statusText, filePath }
            );
        }
        return response.arrayBuffer();
    } catch (error) {
        throw new FileManagerError("FileManager.readFileBufferFromPath: 讀取文件失敗", error);
    }
}

async function createFileV0(props: CreateFileProps): Promise<FileDetails> {
    try {
        const fileBuffer = await readFileBufferFromPath(props.filePath);
        const contentHash = await sha256Hex(fileBuffer);

        return {
            manifestVersion: props.manifestVersion ?? FILE_MANIFEST_VERSION,
            value: props.value,
            // Hash file bytes directly so checksum can be verified by re-hashing the same content.
            hash: contentHash,
            preview: null,
            url: props.needParcel ? null : props.filePath,
            parcelId: null,
        };
    } catch (error) {
        throw new FileManagerError("FileManager.createFile: 建立文件 metadata 失敗", error);
    }
}

async function verifyFileHash(filePath: string, expectedHash: string): Promise<boolean> {
    try {
        const normalizedExpected = expectedHash.trim().toLowerCase();
        const fileBuffer = await readFileBufferFromPath(filePath);
        const actualHash = await sha256Hex(fileBuffer);
        return actualHash === normalizedExpected;
    } catch (error) {
        throw new FileManagerError("FileManager.verifyFileHash: 文件 hash 驗證失敗", error);
    }
}

const createFile = createFileV0;
const createPreview = createPreviewV0;

const FileManager = {
    createFile,
    createPreview,
    verifyFileHash,
};

export { FileManager };