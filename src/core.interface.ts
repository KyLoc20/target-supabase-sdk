import { PostgrestError } from "@supabase/supabase-js";

export interface Target {
  id: string;
  category: string;
  name: string;
  value: string;
  tagList: string[];
  extra?: string;
  details?: unknown;
  created_at: string;
}

export type TargetPayload<T extends Target> = Omit<T, "id" | "created_at">;

export enum StatusCode {
  SUCCESS = 200,
  ERROR = 400,
}

export interface SupabaseResponse<T = unknown> {
  status_code: StatusCode;
  success: boolean;
  message?: string;
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
}

export const generateResponse = {
  success<T>(data?: T, message?: string): SupabaseResponse<T> {
    return {
      status_code: StatusCode.SUCCESS,
      success: true,
      message,
      data,
    };
  },

  error(
    message: string | { key: string; error: PostgrestError } | { key: string; error: string },
    statusCode?: StatusCode,
    code?: string
  ): SupabaseResponse {
    if (typeof message === "string") {
      return {
        status_code: statusCode ?? StatusCode.ERROR,
        success: false,
        error: {
          message,
          code,
        },
      };
    }
    if (typeof message?.error === "string") {
      return {
        status_code: statusCode ?? StatusCode.ERROR,
        success: false,
        error: {
          message: `Error from ${message.key}: ${message.error}`,
          code,
        },
      };
    }
    return {
      status_code: statusCode ?? StatusCode.ERROR,
      success: false,
      error: {
        message: `Error from ${message.key}: ${message?.error?.message}`,
        code,
      },
    };
  },
};
