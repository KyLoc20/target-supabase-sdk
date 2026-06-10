import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import { QuestionList, CategoryQuestionList, QuestionListDetails } from "./question-list.interface";

export class PostCreateQuestionListValidator extends BaseValidator<PostCreateQuestionListPayload> {
  protected requiredFields: (keyof PostCreateQuestionListPayload)[] = ["name", "list"];
  protected optionalFields: (keyof PostCreateQuestionListPayload)[] = [];

  constructor() {
    super();
    // Add custom
    this.addValidator((val) => {
      return true;
    });
  }
}

export interface PostCreateQuestionListPayload {
  name: QuestionListDetails["name"];
  list: QuestionListDetails["list"];
}

export const postCreateQuestionList = async (payload: PostCreateQuestionListPayload) => {
  return createTarget<QuestionList, PostCreateQuestionListPayload>({
    payload: payload,
    validator: PostCreateQuestionListValidator,
    createFn: (validPayload) => {
      const { name, list } = validPayload;
      const details: QuestionListDetails = {
        name,
        list,
      };
      return {
        name: validPayload.name,
        category: CategoryQuestionList.QUESTION_LIST,
        value: "",
        tagList: [],
        details,
      };
    },
  });
};
