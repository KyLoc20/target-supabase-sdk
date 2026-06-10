import { Target } from "../core.interface";

export interface Question {
  ans: string;
  reminder: string;
}

export type QuestionListDetails = {
  /** Human readable name, should be same to Target.name */
  name: string;
  list: Question[];
};

export enum CategoryQuestionList {
  QUESTION_LIST = "question-list",
}

export interface QuestionList extends Target {
  category: CategoryQuestionList;
  details: QuestionListDetails;
}
