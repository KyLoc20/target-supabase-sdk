import { supabase } from "..";
import { createResponse } from "../core.interface";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  confirmPassword?: string;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string;
}

// 用户注册
export const registerUser = async ({ email, password }: RegisterPayload) => {
  const { data, error } = await supabase.authClient!.auth.signUp({
    email,
    password,
  });

  if (error) {
    console.error("[registerUser] failed:", error.message);
    throw error;
  }

  return createResponse.success(data);
};

// 用户登录
export const loginUser = async ({ email, password }: LoginPayload) => {
  const { data, error } = await supabase.authClient!.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("[loginUser] failed:", error.message);
    throw error;
  }

  return createResponse.success(data);
};

// 用户登出
export const logoutUser = async () => {
  const { error } = await supabase.authClient!.auth.signOut();

  if (error) {
    console.error("[logoutUser] failed:", error.message);
    throw error;
  }

  return createResponse.success();
};

// 获取当前用户
export const getCurrentUser = async () => {
  const {
    data: { user },
    error,
  } = await supabase.authClient!.auth.getUser();

  if (error) {
    console.error("[getCurrentUser] failed:", error.message);
    throw error;
  }

  return createResponse.success<User | null>(user as User | null);
};

// 重置密码
export const resetPassword = async (email: string) => {
  const { error } = await supabase.authClient!.auth.resetPasswordForEmail(email);

  if (error) {
    console.error("[resetPassword] failed:", error.message);
    throw error;
  }

  return createResponse.success();
};
