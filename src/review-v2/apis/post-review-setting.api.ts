import { createTarget, validateWith } from "../../core.api";
import { BaseValidator } from "../../core.utils";
import { ReviewSettingDetails, ReviewSetting, CategoryReviewSetting } from "../review-setting.interface";

export interface PostReviewSettingPayload {
  name: ReviewSettingDetails["name"];
  questionList: ReviewSettingDetails["questionList"];
}

export class PostReviewSettingValidator extends BaseValidator<PostReviewSettingPayload> {
  protected requiredFields: (keyof PostReviewSettingPayload)[] = ["name", "questionList"];
  protected optionalFields: (keyof PostReviewSettingPayload)[] = [];
}

export const postReviewSetting = validateWith<PostReviewSettingPayload, PostReviewSettingValidator>(
  PostReviewSettingValidator
)(async (validPayload) => {
  return createTarget<ReviewSetting, PostReviewSettingPayload>({
    payload: validPayload,
    createFn: (validPayload) => {
      const { name, questionList } = validPayload;
      const details: ReviewSettingDetails = {
        name,
        questionList,
      };
      return {
        name,
        category: CategoryReviewSetting.REVIEW_SETTING,
        value: "",
        tagList: [],
        details,
      };
    },
  });
});
