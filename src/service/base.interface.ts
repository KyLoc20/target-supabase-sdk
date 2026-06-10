import { Target } from "../core.interface";

export enum LifecycleStatus {
  ACTIVE = "ACTIVE",
  DEPRECATED = "DEPRECATED",
  SUNSET = "SUNSET",
}

export interface Lifecycle {
  status: LifecycleStatus;
  /** YYYY-MM-DD */
  activeSince: string;
  deprecatedAt: string | null;
  sunsetAt: string | null;
}

export type Field =
  | {
    type: "string";
    nullable: boolean;
    required: boolean;
    /** 1 */
    minLength: number;
    /** 64 */
    maxLength: number;
    /** ^[a-z0-9_-]+$ */
    pattern: string;
  }
  | {
    type: "number";
    nullable: boolean;
    required: boolean;
    /** 1 */
    minimum: number;
    /** 64 */
    maximum: number;
  }
  | {
    type: "boolean";
    nullable: boolean;
    required: boolean;
  }
  | {
    type: "enum";
    nullable: boolean;
    required: boolean;
    /** 'core.Gender.0' */
    enumKey: string;
  }
  | {
    type: "array";
    nullable: boolean;
    required: boolean;
    /** 'string'|'number'|'boolean'|'enum.enumKey'|'ref.refKey' */
    itemType: string;
  }
  | {
    /** Object */
    type: "ref";
    nullable: boolean;
    required: boolean;
    /** 'core.QuestionReview.0' */
    refKey: string;
  };


export interface TargetDescriptor extends Target {
  /** "core.QuestionReview.0" 唯一键 领域 + targetName + VERSION */
  value: string;
  category: 'target-descriptor';
  details: TargetDescriptorDetails;
}

export interface TargetDescriptorDetails {
  list: Array<{
    name: string;
  } & Field>;
  refMap?: Record<string, TargetDescriptor>;
  enumMap?: Record<string, string[]>;
  manifestVersion: number;
}

export interface EnumDescriptor extends Target {
  /** "core.Gender.0" 唯一键 领域 + enumName + VERSION */
  value: string;
  category: 'target-descriptor';
  details: EnumDescriptorDetails;
}

export interface EnumDescriptorDetails {
  list: Array<{
    key: string;
    value: string;
  }>;
  manifestVersion: number;
}

