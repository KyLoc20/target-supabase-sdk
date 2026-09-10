import type { MediaValue } from "./media.interface";

const VIDEO_EXT_MIME: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    ts: "video/mp2t",
    m2ts: "video/mp2t",
};

const AUDIO_EXT_MIME: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/opus",
    wma: "audio/x-ms-wma",
};

const IMAGE_EXT_MIME: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
};

function extensionOf(pathOrUrl: string): string {
    const cleaned = pathOrUrl.split(/[?#]/)[0] ?? pathOrUrl;
    const base = cleaned.replace(/\\/g, "/").split("/").pop() ?? cleaned;
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) {
        return "";
    }
    return base.slice(dot + 1).toLowerCase();
}

/** Guess MIME from path extension; `null` when unknown. */
export function guessMediaMime(locator: string, value: Exclude<MediaValue, "image-list">): string | null {
    const ext = extensionOf(locator);
    if (ext === "") {
        return null;
    }
    if (value === "video") {
        return VIDEO_EXT_MIME[ext] ?? null;
    }
    if (value === "audio") {
        return AUDIO_EXT_MIME[ext] ?? null;
    }
    return IMAGE_EXT_MIME[ext] ?? null;
}
