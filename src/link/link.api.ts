import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import { Link, LinkDetails } from "./link.interface";

export interface PostLinkCreatePayload {
  name: Link["name"];
  value: Link["value"];
  category: Link["category"];
  details: LinkDetails;
}

export class PostLinkValidator extends BaseValidator<PostLinkCreatePayload> {
  protected requiredFields: (keyof PostLinkCreatePayload)[] = ["name", "value", "category", "details"];
  protected optionalFields: (keyof PostLinkCreatePayload)[] = [];

  constructor() {
    super();
    // Add custom
    this.addCustomValidator((val) => {
      return true;
    });
  }
}



export const postLinkCreate = async (payload: PostLinkCreatePayload) => {
  return createTarget<Link, PostLinkCreatePayload>({
    payload: payload,
    validator: PostLinkValidator,
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
