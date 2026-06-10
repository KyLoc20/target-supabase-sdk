import { Target } from "../core.interface";

export enum ReviewDomain {
  /** the larger the number, the more popular it is */
  LIKES = "likes",
}

export type ReviewDetails = {
  reviewTargetId: string;
  lastUpdated: number;
  reviewDomain: ReviewDomain;
  /** Auto increment */
  reviewCount?: number;
  reviewResult?: {
    /** reviewDomain */
    [name: string]: number;
  };
};

export enum CategoryReview {
  REVIEW = "review",
}
export interface Review extends Target {
  category: CategoryReview;
  details: ReviewDetails;
}
