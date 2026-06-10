import { Target } from "../core.interface";

export enum CategoryFile {
  VIDEO = "video",
  IMAGE = "image",
  TEXT = "text",
}

export interface File extends Target {
  details: FileDetails;
  category: CategoryFile;
}

export interface FileDetails {
  manifestVersion: number;
  /** "abc.1" 唯一键 */
  value: string;
  hash: string | null;
  preview: FilePreview | null;
  /** Quickly access the file */
  url: string | null;
  parcelId: string | null;
  /** TODO 消費與改動歷史 */
  // reviewList?: string[];
};

export interface FilePreview {
  manifestVersion: number;
  refTargetId: string;
};