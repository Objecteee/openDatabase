import { create } from "zustand";

export interface AuthUser {
  id: string;
  username?: string;
  email?: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  setAuth: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string | null) => void;
  logoutLocal: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  setAuth: (user, accessToken) => set({ user, accessToken }),
  setAccessToken: (token) => set({ accessToken: token }),
  logoutLocal: () => set({ user: null, accessToken: null }),
}));

