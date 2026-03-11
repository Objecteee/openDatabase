import { create } from "zustand";
import { api } from "../lib/apiClient.js";

export interface DocumentItem {
  id: string;
  name: string;
  type: string;
  size: number;
  status: string;
  created_at: string;
}

interface DocumentsState {
  docs: DocumentItem[];
  loading: boolean;
  error: string | null;
  fetchDocs: () => Promise<void>;
  deleteDoc: (id: string) => Promise<void>;
  getPreviewUrl: (id: string) => Promise<string | null>;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  docs: [],
  loading: false,
  error: null,

  fetchDocs: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.get("/documents");
      const data = res.data as DocumentItem[];
      set({ docs: Array.isArray(data) ? data : [], loading: false, error: null });
    } catch (e) {
      set({ docs: [], loading: false, error: e instanceof Error ? e.message : "加载失败" });
    }
  },

  deleteDoc: async (id: string) => {
    await api.delete(`/documents/${id}`);
    set({ docs: get().docs.filter((d) => d.id !== id) });
  },

  getPreviewUrl: async (id: string) => {
    const res = await api.get(`/documents/${id}/url`);
    const url = (res.data as { url?: string }).url ?? null;
    return url;
  },
}));

