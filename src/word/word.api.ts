import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import { Word, WordDetails } from "./word.interface";

export interface PostWordCreatePayload {
  name: Word["name"];
  value: Word["value"];
  category: Word["category"];
  details: WordDetails;
}

export class PostWordValidator extends BaseValidator<PostWordCreatePayload> {
  protected requiredFields: (keyof PostWordCreatePayload)[] = ["name", "value", "category", "details"];
  protected optionalFields: (keyof PostWordCreatePayload)[] = [];

  constructor() {
    super();
    // Add custom
    this.addCustomValidator((val) => {
      return true;
    });
  }
}



export const postWordCreate = async (payload: PostWordCreatePayload) => {
  return createTarget<Word, PostWordCreatePayload>({
    payload: payload,
    validator: PostWordValidator,
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
