import { create } from "zustand";
import { api } from "../lib/apiClient.js";

export interface AuthUser {
  id: string;
  username?: string;
  email?: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** 启动时是否已完成“尝试 refresh 恢复登录态” */
  initialized: boolean;
  /** 初始化中（用于路由守卫显示加载态） */
  initializing: boolean;
  setAuth: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string | null) => void;
  logoutLocal: () => void;
  /** App 启动时调用：若 refresh cookie 有效则恢复登录态 */
  initAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  initializing: false,
  setAuth: (user, accessToken) => set({ user, accessToken }),
  setAccessToken: (token) => set({ accessToken: token }),
  logoutLocal: () => set({ user: null, accessToken: null, initialized: true, initializing: false }),
  initAuth: async () => {
    // 幂等：避免重复初始化
    const { initialized, initializing } = useAuthStore.getState();
    if (initialized || initializing) return;
    set({ initializing: true });
    try {
      const res = await api.post("/auth/refresh", {});
      const data = res.data as { user?: AuthUser; access_token?: string };
      if (data.user && data.access_token) {
        set({ user: data.user, accessToken: data.access_token });
      } else {
        set({ user: null, accessToken: null });
      }
    } catch {
      // refresh cookie 不存在/过期：视为未登录
      set({ user: null, accessToken: null });
    } finally {
      set({ initialized: true, initializing: false });
    }
  },
}));

