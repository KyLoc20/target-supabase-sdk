import { createTarget, getTarget, validateWith } from "../../core.api";
import { BaseValidator } from "../../core.utils";
import { CategoryReview, ReviewV2 as Review, ReviewV2Details as ReviewDetails } from "../review.interface";
import { ReviewSetting } from "../review-setting.interface";

export interface PostReviewPayload {
  targetId: ReviewDetails["targetId"];
  settingId: ReviewDetails["settingId"];
  resultList: ReviewDetails["resultList"];
}

export class PostReviewValidator extends BaseValidator<PostReviewPayload> {
  protected requiredFields: (keyof PostReviewPayload)[] = ["targetId", "targetId", "resultList"];
  protected optionalFields: (keyof PostReviewPayload)[] = [];
}

export const postReview = validateWith<PostReviewPayload, PostReviewValidator>(PostReviewValidator)(
  async (validPayload: PostReviewPayload) => {
    const { targetId, settingId, resultList } = validPayload;

    // Check Target
    if (targetId != null) {
      const { data: possibleTarget } = await getTarget({
        id: targetId,
      });
      // TODO
    }

    // Check ReviewSetting
    const { data: _reviewSetting } = await getTarget({
      id: settingId,
    });
    if (_reviewSetting == null) {
      console.error("[postReview] ReviewSetting not found");
      throw new Error("[postReview] ReviewSetting not found");
    }
    const reviewSetting = _reviewSetting as ReviewSetting;

    return createTarget<Review, PostReviewPayload>({
      payload: validPayload,
      createFn: (validPayload) => {
        const { targetId, settingId, resultList } = validPayload;
        const details: ReviewDetails = {
          targetId,
          settingId,
          resultList,
        };
        const name = `Review on ${reviewSetting?.details?.name}`;
        return {
          name,
          category: CategoryReview.REVIEW,
          value: "",
          tagList: [],
          details,
        };
      },
    });
  }
);
