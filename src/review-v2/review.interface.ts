import { Target } from "../core.interface";
import { ReviewQuestion } from "./review-setting.interface";

/** Instance of ReviewSetting */
export interface ReviewV2 extends Target {
  category: CategoryReview;
  details: ReviewV2Details;
}

export enum CategoryReview {
  REVIEW = "review",
}

export type ReviewV2Details = {
  targetId: string | null;
  /** How to collect reviews from users and how to parse the results */
  settingId: string;
  resultList: ReviewResult[];
};

export interface ReviewResult extends ReviewQuestion {
  answer: unknown;
}
