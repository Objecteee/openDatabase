/**
 * 对话页 — RAG 增强版 + 会话持久化
 *
 * - 左侧会话列表：新对话、历史会话（标题、时间）、删除
 * - 右侧消息区：当前会话消息、输入框；发送时带 conversation_id，新对话时由服务端创建并返回
 */

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { embed } from "../lib/embeddingClient.js";
import { getEmbeddingState } from "../lib/embeddingClient.js";
import { api } from "../lib/apiClient.js";
import { useAuthStore } from "../stores/authStore.js";
import { useChatStore } from "../stores/chatStore.js";
import { useTranslation } from "react-i18next";
import styles from "./ChatPage.module.scss";

// ─── 类型 ────────────────────────────────────────────────────────────
import type { Citation, Message } from "../stores/chatStore.js";

interface DocumentItem {
  id: string;
  name: string;
  type: string;
  status?: string;
}

const DOCUMENTS_API = "/documents";

// ─── 组件 ────────────────────────────────────────────────────────────

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const conversations = useChatStore((s) => s.conversations);
  const conversationsLoading = useChatStore((s) => s.conversationsLoading);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const messages = useChatStore((s) => s.messages);
  const boundDocumentIds = useChatStore((s) => s.boundDocumentIds);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const newChat = useChatStore((s) => s.newChat);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [allDocuments, setAllDocuments] = useState<DocumentItem[]>([]);
  const [docPickerLoading, setDocPickerLoading] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingChunksRef = useRef<string[]>([]);
  const assistantIdRef = useRef<string>("");

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!conversationsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConversationsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationsOpen]);

  const handleNewChat = useCallback(() => {
    newChat();
    setError(null);
    setConversationsOpen(false);
  }, [newChat]);

  const openDocPicker = useCallback(async () => {
    if (!currentConversationId) return;
    setDocPickerOpen(true);
    setDocPickerLoading(true);
    try {
      const [docsRes, boundRes] = await Promise.all([
        api.get(DOCUMENTS_API),
        api.get(`/conversations/${currentConversationId}/documents`),
      ]);
      const docs = docsRes.data as DocumentItem[];
      setAllDocuments(Array.isArray(docs) ? docs : []);
      const ids = (boundRes.data as { document_ids?: string[] }).document_ids ?? [];
      // boundDocumentIds 已由 store 维护，这里不额外 set；只保证弹层显示更新
      void ids;
    } finally {
      setDocPickerLoading(false);
    }
  }, [currentConversationId]);

  const toggleBoundDocument = useCallback(
    async (docId: string) => {
      if (!currentConversationId) return;
      if (docPickerLoading) return;
      setDocPickerLoading(true);
      try {
        const currentlyBound = boundDocumentIds.has(docId);
        if (currentlyBound) {
          await api.delete(`/conversations/${currentConversationId}/documents/${docId}`);
        } else {
          await api.post(`/conversations/${currentConversationId}/documents`, { document_id: docId });
        }
        // 重新加载绑定集合（后端已更新）
        await useChatStore.getState().refreshBoundDocs(currentConversationId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败");
      } finally {
        setDocPickerLoading(false);
      }
    },
    [boundDocumentIds, currentConversationId, docPickerLoading]
  );

  const handleDeleteConversation = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(t("chat.confirmDeleteConversation"))) return;
      try {
        await deleteConversation(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除失败");
      } finally {
        setConversationsOpen(false);
      }
    },
    [deleteConversation, t]
  );

  const formatConversationDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const flushStreamingContent = useCallback(() => {
    if (pendingChunksRef.current.length === 0) return;
    const chunks = pendingChunksRef.current.splice(0);
    const text = chunks.join("");
    useChatStore.setState((s) => {
      const prev = s.messages;
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return { messages: [...prev.slice(0, -1), { ...last, content: last.content + text }] };
      }
      return { messages: prev };
    });
  }, []);

  const tick = useCallback(() => {
    flushStreamingContent();
    scrollToBottom();
    rafIdRef.current = requestAnimationFrame(tick);
  }, [flushStreamingContent, scrollToBottom]);

  const startStreaming = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopStreaming = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    flushStreamingContent();
  }, [flushStreamingContent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    useChatStore.setState((s) => ({ messages: [...s.messages, userMsg] }));

    const assistantId = crypto.randomUUID();
    assistantIdRef.current = assistantId;
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };
    useChatStore.setState((s) => ({ messages: [...s.messages, assistantMsg] }));

    setLoading(true);
    pendingChunksRef.current = [];
    startStreaming();

    try {
      // ── 向量化用户输入（embedding 模型已就绪时执行）──────────────
      let queryEmbedding: number[] | undefined;
      const embState = getEmbeddingState();
      if (embState.state === "ready") {
        try {
          queryEmbedding = await embed(text);
        } catch {
          // 向量化失败不阻断对话，降级为纯对话
        }
      }

      const accessToken = useAuthStore.getState().accessToken;

      // SSE 请求必须显式携带 Authorization（fetch 不走 axios 拦截器）
      const doChatFetch = async () =>
        fetch(`/api/chat`, {
        method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            messages: [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: "user" as const, content: text },
            ],
            ...(queryEmbedding ? { queryEmbedding } : {}),
            ...(currentConversationId ? { conversation_id: currentConversationId } : {}),
            // 方案 B：前端不显式传 document_ids；由后端根据会话绑定文档决定过滤范围
          }),
        });

      let res = await doChatFetch();
      // 如果 access token 过期：尝试走 refresh（axios 队列+并发锁），拿新 token 后重试一次
      if (res.status === 401) {
        try {
          await api.post("/auth/refresh");
          res = await doChatFetch();
        } catch {
          // ignore，后续会走通用错误提示
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "请求失败");
      }

      // ── 解析 SSE 流 ──────────────────────────────────────────────────
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) throw new Error("无法读取响应流");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);

            if (json.type === "conversation_id" && typeof json.id === "string") {
              useChatStore.setState({ currentConversationId: json.id });
              fetchConversations();
              continue;
            }

            if (json.type === "citations") {
              const citations = json.chunks as Citation[];
              useChatStore.setState((s) => ({
                messages: s.messages.map((m) => (m.id === assistantId ? { ...m, citations } : m)),
              }));
              continue;
            }

            if (json.type === "error") {
              throw new Error(json.error);
            }

            // 标准 OpenAI delta token
            const content =
              json.choices?.[0]?.delta?.content ??
              json.choices?.[0]?.message?.content;
            if (typeof content === "string" && content) {
              pendingChunksRef.current.push(content);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected token") {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
      useChatStore.setState((s) => ({
        messages: s.messages.map((m) => (m.id === assistantId ? { ...m, content: "（请求失败）", streaming: false } : m)),
      }));
    } finally {
      stopStreaming();
      setLoading(false);
      useChatStore.setState((s) => ({
        messages: s.messages.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      }));
      scrollToBottom();
    }
  };

  return (
    <div className={styles.page}>
      {/* 左侧会话列表 */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <button
            type="button"
            onClick={handleNewChat}
            className={styles.newChatBtn}
          >
            + {t("chat.newChat")}
          </button>
        </div>
        <div className={styles.convList}>
          {conversationsLoading ? (
            <div className={styles.convEmpty}>{t("app.common.loading")}</div>
          ) : conversations.length === 0 ? (
            <div className={styles.convEmpty}>{t("chat.noConversations")}</div>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => loadConversation(c.id)}
                    onKeyDown={(e) => e.key === "Enter" && loadConversation(c.id)}
                    className={`${styles.convItem} ${currentConversationId === c.id ? styles.convItemActive : ""}`}
                  >
                    <span className={styles.convTitle} title={c.title ?? t("chat.newChat")}>
                      {c.title?.trim() || t("chat.newChat")}
                    </span>
                    <span className={styles.convMeta}>
                      {formatConversationDate(c.updated_at)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(c.id, e)}
                      className={styles.convDelete}
                      title={t("app.common.delete")}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className={styles.panel}>
        {/* 会话工具栏：仅在已选中会话时展示 */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeftWrap}>
            <button
              type="button"
              className={`${styles.toolbarBtn} ${styles.mobileOnly}`}
              onClick={() => setConversationsOpen(true)}
              aria-label="conversations"
            >
              ☰ {t("chat.toolbar.openConversations")}
            </button>
            <div className={styles.toolbarLeft}>
            {currentConversationId ? (
              <span>{t("chat.toolbar.boundDocs", { count: boundDocumentIds.size })}</span>
            ) : (
              <span>{t("chat.toolbar.noConversation")}</span>
            )}
            </div>
          </div>
          <div>
            <button
              type="button"
              disabled={!currentConversationId}
              onClick={openDocPicker}
              className={styles.toolbarBtn}
              title={!currentConversationId ? t("chat.toolbar.noConversation") : t("chat.toolbar.bindDocs")}
            >
              {t("chat.toolbar.bindDocs")}
            </button>
          </div>
        </div>

        <main className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.startHint}>{t("chat.startHint")}</div>
          )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.msgRow} ${msg.role === "user" ? styles.msgRowUser : styles.msgRowAssistant}`}
          >
            {/* 消息气泡 */}
            <div
              className={`${styles.bubble} ${msg.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}`}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              ) : (
                <div className={styles.md}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content || (msg.streaming ? "..." : "")}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {/* 引用来源卡片（仅 assistant 消息，有 citations 时展示）*/}
            {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
              <div className="mt-2 max-w-[80%] w-full">
                <p className="text-xs text-slate-400 mb-1 px-1">{t("chat.citations.title")}</p>
                <div className="flex flex-col gap-1.5">
                  {msg.citations.map((c, idx) => (
                    <CitationCard key={c.id} index={idx + 1} citation={c} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </main>

      {error && <div className={styles.errorBar}>{error}</div>}

      <form onSubmit={handleSubmit} className={styles.composer}>
        <div className={styles.composerInner}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("chat.inputPlaceholder")}
            className={styles.input}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className={styles.sendBtn}
          >
            {loading ? t("chat.sendLoading") : t("chat.send")}
          </button>
        </div>
      </form>
      </div>

      {/* 关联文档弹层 */}
      {docPickerOpen && currentConversationId && (
        <div
          className={styles.overlay}
          onClick={() => !docPickerLoading && setDocPickerOpen(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>{t("chat.docPicker.title")}</div>
              <button
                type="button"
                disabled={docPickerLoading}
                onClick={() => setDocPickerOpen(false)}
                className={styles.modalClose}
                title={t("app.common.close")}
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              {docPickerLoading ? (
                <div className="text-sm text-slate-500">{t("chat.docPicker.loading")}</div>
              ) : allDocuments.length === 0 ? (
                <div className="text-sm text-slate-500">{t("chat.docPicker.empty")}</div>
              ) : (
                <div className={styles.docListBox}>
                  <ul>
                    {allDocuments.map((d) => {
                      const checked = boundDocumentIds.has(d.id);
                      const disabled = d.status === "failed" || d.status === "processing";
                      return (
                        <li key={d.id} className={styles.docRow}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={docPickerLoading || disabled}
                            onChange={() => toggleBoundDocument(d.id)}
                          />
                          <div className={styles.docMeta}>
                            <div className={styles.docName} title={d.name}>
                              {d.name}
                            </div>
                            <div className={styles.docSub}>
                              {d.type}
                              {d.status ? ` · ${d.status}` : ""}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className={styles.hint}>{t("chat.docPicker.hint")}</div>
            </div>
          </div>
        </div>
      )}

      {/* 移动端会话抽屉 */}
      {conversationsOpen && (
        <div className={styles.drawerOverlay} onClick={() => setConversationsOpen(false)}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitle}>{t("chat.toolbar.openConversations")}</div>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setConversationsOpen(false)}
                title={t("app.common.close")}
              >
                ×
              </button>
            </div>
            {/* 复用同一份会话列表 UI（样式一致） */}
            <div className={styles.sidebarHeader}>
              <button
                type="button"
                onClick={handleNewChat}
                className={styles.newChatBtn}
              >
                + {t("chat.newChat")}
              </button>
            </div>
            <div className={styles.convList}>
              {conversationsLoading ? (
                <div className={styles.convEmpty}>{t("app.common.loading")}</div>
              ) : conversations.length === 0 ? (
                <div className={styles.convEmpty}>{t("chat.noConversations")}</div>
              ) : (
                <ul>
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          loadConversation(c.id);
                          setConversationsOpen(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            loadConversation(c.id);
                            setConversationsOpen(false);
                          }
                        }}
                        className={`${styles.convItem} ${currentConversationId === c.id ? styles.convItemActive : ""}`}
                      >
                        <span className={styles.convTitle} title={c.title ?? t("chat.newChat")}>
                          {c.title?.trim() || t("chat.newChat")}
                        </span>
                        <span className={styles.convMeta}>{formatConversationDate(c.updated_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 引用来源卡片组件 ─────────────────────────────────────────────────

interface CitationCardProps {
  index: number;
  citation: Citation;
}

/** 根据 pointer 格式判断图标：页码 → 📄，时间戳 → 🕐，无 → 📎 */
function pointerIcon(pointer: string | null): string {
  if (!pointer) return "📎";
  if (pointer.startsWith("p.")) return "📄";
  return "🕐";
}

/** 将时间戳 pointer 转为视频/音频 URL hash（#t=秒数），供浏览器跳转 */
function buildTimestampUrl(fileUrl: string, pointer: string): string {
  const parts = pointer.split(":");
  if (parts.length !== 3) return fileUrl;
  const [h, m, s] = parts.map(Number);
  const totalSec = (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  return `${fileUrl}#t=${totalSec}`;
}

/** 将 PDF 页码 pointer（"p.3"）转为带 #page=N 的 URL，Chrome 内置阅读器支持跳转 */
function buildPdfPageUrl(fileUrl: string, pointer: string): string {
  const pageNum = parseInt(pointer.slice(2), 10);
  if (isNaN(pageNum)) return fileUrl;
  return `${fileUrl}#page=${pageNum}`;
}

function CitationCard({ index, citation }: CitationCardProps) {
  const [expanded, setExpanded] = useState(false);

  const summary = (citation.metadata?.summary ?? citation.document_name) as string | undefined;
  const keywords = citation.metadata?.keywords as string[] | undefined;
  const { document_name, pointer, file_url } = citation;

  // 构造跳转 URL：
  //   视频/音频时间戳 → #t=秒数（所有浏览器支持）
  //   PDF 页码       → #page=N（Chrome 内置 PDF 阅读器支持，其他浏览器打开文件首页）
  //   其他           → 直接打开文件
  const jumpUrl = (() => {
    if (!file_url) return null;
    if (!pointer) return file_url;
    if (pointer.startsWith("p.")) return buildPdfPageUrl(file_url, pointer);
    return buildTimestampUrl(file_url, pointer);
  })();

  const handleOpenSource = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (jumpUrl) window.open(jumpUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
      {/* 卡片头部：序号 + 文档名 + pointer + 展开/跳转按钮 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium flex items-center justify-center">
              {index}
            </span>
            <div className="min-w-0">
              {/* 文档名 */}
              <p className="text-xs font-medium text-slate-700 truncate">
                {document_name ?? summary ?? "未知文档"}
              </p>
              {/* pointer：页码或时间戳 */}
              {pointer && (
                <p className="text-xs text-indigo-500 mt-0.5">
                  {pointerIcon(pointer)}&nbsp;
                  {pointer.startsWith("p.") ? `第 ${pointer.slice(2)} 页` : pointer}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* 跳转源文件按钮 */}
            {jumpUrl && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleOpenSource}
                onKeyDown={(e) => e.key === "Enter" && handleOpenSource(e as unknown as React.MouseEvent)}
                title={pointer?.startsWith("p.") ? "打开源文件" : "跳转到对应时间点"}
                className="text-xs text-indigo-400 hover:text-indigo-600 px-1.5 py-0.5 rounded hover:bg-indigo-50 transition-colors cursor-pointer"
              >
                {pointer?.startsWith("p.") ? "查看原文 ↗" : "跳转 ↗"}
              </span>
            )}
            <span className="text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>

        {/* 关键词标签 */}
        {keywords && keywords.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 pl-7">
            {keywords.slice(0, 4).map((kw) => (
              <span key={kw} className="text-xs bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded">
                {kw}
              </span>
            ))}
          </div>
        )}
      </button>

      {/* 展开内容：chunk 原文 */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-200">
          <p className="pl-7 text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">
            {citation.content}
          </p>
        </div>
      )}
    </div>
  );
}
