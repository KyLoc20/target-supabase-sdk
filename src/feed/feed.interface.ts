import { Target } from "../core.interface";

export interface Feed extends Target {
  category: CategoryFeed;
  details: FeedDetails;
}

export enum CategoryFeed {
  FEED = "feed",
  DOC = "doc",
}

export interface FeedDetails {
  manifestVersion: number;
  list: FeedItem[];
}

export enum FeedItemType {
  /** Plain Target */
  TEXT = "TEXT",
  /** Parcel */
  IMAGE = "IMAGE",
  /** Parcel */
  VIDEO = "VIDEO",
  /** TODO Review */
  // REVIEW = "REVIEW",
}

export interface FeedItem {
  index: number;
  type: FeedItemType;
  refTargetId: string;
}
