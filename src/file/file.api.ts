import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import { File, CategoryFile, FileDetails } from "./file.interface";

export interface PostFileCreatePayload {
  name: File["name"];
  value: File["value"];
  category: File["category"];
  details: FileDetails;
}

export class PostFileValidator extends BaseValidator<PostFileCreatePayload> {
  protected requiredFields: (keyof PostFileCreatePayload)[] = ["name", "value", "category", "details"];
  protected optionalFields: (keyof PostFileCreatePayload)[] = [];

  constructor() {
    super();
    // Add custom
    this.addCustomValidator((val) => {
      return true;
    });
  }
}



export const postFileCreate = async (payload: PostFileCreatePayload) => {
  return createTarget<File, PostFileCreatePayload>({
    payload: payload,
    validator: PostFileValidator,
    createFn: (validPayload) => {
      const { name, value, category, details } = validPayload;

      return {
        name,
        category,
        value,
        tagList: [],
        details,
      };
    },
  });
};
