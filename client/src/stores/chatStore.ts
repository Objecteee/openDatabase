import { create } from "zustand";
import { api } from "../lib/apiClient.js";

export interface Citation {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  document_name: string | null;
  pointer: string | null;
  file_url: string | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  citations?: Citation[];
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatState {
  conversations: Conversation[];
  conversationsLoading: boolean;
  currentConversationId: string | null;
  messages: Message[];
  boundDocumentIds: Set<string>;

  fetchConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  newChat: () => void;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;

  refreshBoundDocs: (conversationId: string) => Promise<void>;
  setBoundDocs: (ids: string[]) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsLoading: false,
  currentConversationId: null,
  messages: [],
  boundDocumentIds: new Set(),

  fetchConversations: async () => {
    set({ conversationsLoading: true });
    try {
      const res = await api.get("/conversations");
      const data = res.data as Conversation[];
      set({ conversations: Array.isArray(data) ? data : [] });
    } finally {
      set({ conversationsLoading: false });
    }
  },

  refreshBoundDocs: async (conversationId: string) => {
    try {
      const res = await api.get(`/conversations/${conversationId}/documents`);
      const ids = (res.data as { document_ids?: string[] }).document_ids ?? [];
      set({ boundDocumentIds: new Set(ids.filter((x) => typeof x === "string")) });
    } catch {
      set({ boundDocumentIds: new Set() });
    }
  },

  setBoundDocs: (ids: string[]) => set({ boundDocumentIds: new Set(ids) }),

  loadConversation: async (id: string) => {
    set({ currentConversationId: id });
    const res = await api.get(`/conversations/${id}/messages`);
    const list = res.data as Array<{ id: string; role: string; content: string; citations?: unknown[] }>;
    set({
      messages: (list ?? []).map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        citations: m.citations as Citation[] | undefined,
      })),
    });
    await get().refreshBoundDocs(id);
  },

  createConversation: async () => {
    const res = await api.post("/conversations", {});
    const id = (res.data as { id?: string }).id;
    if (typeof id !== "string" || !id) throw new Error("创建会话失败");
    set({ currentConversationId: id, messages: [], boundDocumentIds: new Set() });
    await get().fetchConversations();
    await get().refreshBoundDocs(id);
    return id;
  },

  newChat: () => set({ currentConversationId: null, messages: [], boundDocumentIds: new Set() }),

  deleteConversation: async (id: string) => {
    await api.delete(`/conversations/${id}`);
    const cur = get().currentConversationId;
    set({
      conversations: get().conversations.filter((c) => c.id !== id),
      ...(cur === id ? { currentConversationId: null, messages: [], boundDocumentIds: new Set() } : {}),
    });
  },

  renameConversation: async (id: string, title: string) => {
    const next = title.trim().slice(0, 200);
    if (!next) throw new Error("标题不能为空");
    await api.patch(`/conversations/${id}`, { title: next });
    set({
      conversations: get().conversations.map((c) => (c.id === id ? { ...c, title: next } : c)),
    });
  },
}));

