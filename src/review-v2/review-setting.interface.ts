import { Target } from "../core.interface";

export interface ReviewSetting extends Target {
  category: CategoryReviewSetting;
  details: ReviewSettingDetails;
}

export enum CategoryReviewSetting {
  REVIEW_SETTING = "review-setting",
}

export type ReviewSettingDetails = {
  name: string;
  questionList: ReviewQuestion[];
};

export interface ReviewQuestion {
  title: string;
  /** uuid */
  key: string;
  type: "$boolean" | "$text" | "$number" | "$choice" | "$custom";
  /** To provide data when rendering a question */
  refTargetId?: string;
  /** To render a custom question */
  customTargetId?: string;
}
