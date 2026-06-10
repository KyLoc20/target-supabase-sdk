import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import { FileList, CategoryFileList, FileListDetails } from "./file-list.interface";

export class PostCreateFileListValidator extends BaseValidator<PostCreateFileListPayload> {
  protected requiredFields: (keyof PostCreateFileListPayload)[] = ["name", "dirName", "dirSize", "storageUrl"];
  protected optionalFields: (keyof PostCreateFileListPayload)[] = [];

  constructor() {
    super();
    // Add custom
    this.addValidator((val) => {
      return true;
    });
  }
}

export interface PostCreateFileListPayload {
  name: FileListDetails["name"];
  dirName: FileListDetails["dirName"];
  dirSize: FileListDetails["dirSize"];
  storageUrl: FileListDetails["storageUrl"];
}

export const postCreateFileList = async (payload: PostCreateFileListPayload) => {
  return createTarget<FileList, PostCreateFileListPayload>({
    payload: payload,
    validator: PostCreateFileListValidator,
    checkRedundancyFilterList: [
      {
        field: "category",
        operator: "eq",
        value: CategoryFileList.FILE_LIST,
      },
      {
        field: "details->>dirName",
        operator: "eq",
        value: payload.dirName,
      },
      {
        field: "details->>storageUrl",
        operator: "eq",
        value: payload.storageUrl,
      },
    ],
    createFn: (validPayload) => {
      const { name, dirName, dirSize, storageUrl = "" } = validPayload;
      const details: FileListDetails = {
        name,
        dirName,
        dirSize,
        storageUrl,
      };

      return {
        name: validPayload.name,
        category: CategoryFileList.FILE_LIST,
        value: dirName,
        tagList: [],
        details,
      };
    },
  });
};
