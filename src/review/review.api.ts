import { cloneDeep } from "lodash-es";
import { createTarget, getPossibleTarget, updateTargetDetails } from "../core.api";
import { createResponse } from "../core.interface";
import { BaseValidator } from "../core.utils";
import { CategoryReview, Review, ReviewDetails } from "./review.interface";

class PatchUpsertReviewValidator extends BaseValidator<ReviewDetails> {
  protected requiredFields: (keyof ReviewDetails)[] = ["reviewTargetId", "reviewDomain", "reviewResult"];
  protected optionalFields: (keyof ReviewDetails)[] = [];
  protected ignoredFields: (keyof ReviewDetails)[] = ["reviewCount", "lastUpdated"];

  constructor() {
    super();
    // Add custom
    this.addValidator((val) => {
      if (val.reviewResult == null || Object.values(val.reviewResult).some((v) => typeof v !== "number")) {
        return "[Check reviewResult] reviewResult invalid";
      }
      return true;
    });
  }
}

export const patchUpsertReview = async (payload: ReviewDetails) => {
  const validPayload = new PatchUpsertReviewValidator().validate(payload);
  const { reviewTargetId, reviewDomain } = validPayload;

  // Check redundancy
  const { data: possibleReview } = await getPossibleTarget({
    filterList: [
      {
        field: "category",
        operator: "eq",
        value: CategoryReview.REVIEW,
      },
      {
        field: "details->>reviewTargetId",
        operator: "eq",
        value: reviewTargetId,
      },
      {
        field: "details->>reviewDomain",
        operator: "eq",
        value: reviewDomain,
      },
    ],
  });

  if (possibleReview != null) {
    const existingReview = possibleReview as Review;
    const id = existingReview.id;
    // Update
    const data = await updateTargetDetails<Review, ReviewDetails>({
      id,
      updateFn: (details) => {
        const incrementResult = validPayload.reviewResult;
        if (incrementResult != null) {
          const updatedResult = details.reviewResult != null ? cloneDeep(details.reviewResult) : {};
          Object.entries(incrementResult).forEach(([key, value]) => {
            updatedResult[key] = (updatedResult[key] ?? 0) + value;
          });
          return {
            ...details,
            reviewResult: updatedResult,
            reviewCount: (details.reviewCount ?? 0) + 1,
            lastUpdated: Date.now(),
          };
        }
        return details;
      },
    });
    return createResponse.success<Review>(data);
  }
  // Create
  const { data: newReview } = await postReview({
    reviewTargetId,
    reviewDomain,
  });
  if (newReview == null) {
    const msg = "[patchUpsertReview] Unable to create Review";
    console.error(msg);
    throw new Error(msg);
  }
  return createResponse.success<Review>(newReview);
};

export interface PostReviewPayload {
  reviewTargetId: ReviewDetails["reviewTargetId"];
  reviewDomain: ReviewDetails["reviewDomain"];
}

export class PostReviewValidator extends BaseValidator<PostReviewPayload> {
  protected requiredFields: (keyof PostReviewPayload)[] = ["reviewTargetId", "reviewDomain"];
  protected optionalFields: (keyof PostReviewPayload)[] = [];

  constructor() {
    super();
    // Add custom
    this.addValidator((val) => {
      return true;
    });
  }
}

export const postReview = async (payload: PostReviewPayload) => {
  return createTarget<Review, PostReviewPayload>({
    payload: payload,
    validator: PostReviewValidator,
    checkRedundancyFilterList: [
      {
        field: "category",
        operator: "eq",
        value: CategoryReview.REVIEW,
      },
      {
        field: "details->>reviewTargetId",
        operator: "eq",
        value: payload.reviewTargetId,
      },
      {
        field: "details->>reviewDomain",
        operator: "eq",
        value: payload.reviewDomain,
      },
    ],
    createFn: (validPayload) => {
      const { reviewTargetId, reviewDomain } = validPayload;
      const details: ReviewDetails = {
        reviewTargetId,
        reviewDomain,
        lastUpdated: Date.now(),
        reviewCount: 0,
        reviewResult: {},
      };
      const reviewStr = `Review ${reviewTargetId} ${reviewDomain}`;
      return {
        name: reviewStr,
        category: CategoryReview.REVIEW,
        value: "",
        tagList: [],
        details,
      };
    },
  });
};
