import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { useAuthStore } from "../stores/authStore.js";

const API_BASE = "/api";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  config: AxiosRequestConfig;
};

let isRefreshing = false;
const queue: PendingRequest[] = [];

function processQueue(error: unknown, token: string | null) {
  while (queue.length) {
    const p = queue.shift()!;
    if (error) {
      p.reject(error);
    } else {
      if (token) {
        p.config.headers = { ...(p.config.headers ?? {}), Authorization: `Bearer ${token}` };
      }
      p.resolve(api(p.config));
    }
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // refresh token 在 httpOnly cookie 中
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    // Axios v1 里 headers 可能是 AxiosHeaders，避免直接整体替换破坏类型/方法
    (config.headers as Record<string, unknown> | undefined) ??= {};
    (config.headers as Record<string, unknown>)["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = err.response?.status;

    if (!original || status !== 401) throw err;
    if (original._retry) throw err;

    original._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject, config: original });
      });
    }

    isRefreshing = true;

    try {
      const refreshRes = await axios.post(
        `${API_BASE}/auth/refresh`,
        {},
        { withCredentials: true, timeout: 30_000 },
      );
      const accessToken = (refreshRes.data as { access_token?: string }).access_token ?? null;
      if (!accessToken) throw new Error("刷新失败：无 access_token");

      useAuthStore.getState().setAccessToken(accessToken);
      processQueue(null, accessToken);
      (original.headers as Record<string, unknown> | undefined) ??= {};
      (original.headers as Record<string, unknown>)["Authorization"] = `Bearer ${accessToken}`;
      return api(original);
    } catch (refreshErr) {
      processQueue(refreshErr, null);
      useAuthStore.getState().logoutLocal();
      throw refreshErr;
    } finally {
      isRefreshing = false;
    }
  },
);

