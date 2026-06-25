import { SupabaseInitializer } from "../supabase";
import { generateResponse } from "../core.interface";
import { handleSupabaseError } from "../core.utils";

const supabase = SupabaseInitializer.getInstance();

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
    handleSupabaseError("registerUser", error, "Registration failed. Please try again.");
  }

  return generateResponse.success(data);
};

// 用户登录
export const loginUser = async ({ email, password }: LoginPayload) => {
  const { data, error } = await supabase.authClient!.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    handleSupabaseError("loginUser", error, "Login failed. Please check your credentials.");
  }

  return generateResponse.success(data);
};

// 用户登出
export const logoutUser = async () => {
  const { error } = await supabase.authClient!.auth.signOut();

  if (error) {
    handleSupabaseError("logoutUser", error, "Logout failed.");
  }

  return generateResponse.success();
};

// 获取当前用户
export const getCurrentUser = async () => {
  const {
    data: { user },
    error,
  } = await supabase.authClient!.auth.getUser();

  if (error) {
    handleSupabaseError("getCurrentUser", error, "Failed to get current user.");
  }

  return generateResponse.success<User | null>(user as User | null);
};

// 重置密码
export const resetPassword = async (email: string) => {
  const { error } = await supabase.authClient!.auth.resetPasswordForEmail(email);

  if (error) {
    handleSupabaseError("resetPassword", error, "Password reset request failed.");
  }

  return generateResponse.success();
};
