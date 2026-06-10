import { Target } from "../core.interface";

/**
 * Use storageUrl+dirName to identify the file list
 * You can iterate all files in the directory
 */
export type FileListDetails = {
  /** Human readable name, should be same to Target.name */
  name: string;
  /** unique path */
  dirName: string;
  dirSize: number;
  /** where to store the file list */
  storageUrl: string;
};

export enum CategoryFileList {
  FILE_LIST = "file-list",
}

export interface FileList extends Target {
  details: FileListDetails;
  category: CategoryFileList;
}
