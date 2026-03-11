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

// ─── 类型 ────────────────────────────────────────────────────────────

interface Citation {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  document_name: string | null;
  pointer: string | null;
  file_url: string | null;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  citations?: Citation[];
}

interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

const API_BASE = "/api";
const CONVERSATIONS_API = `${API_BASE}/conversations`;

// ─── 组件 ────────────────────────────────────────────────────────────

export function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingChunksRef = useRef<string[]>([]);
  const assistantIdRef = useRef<string>("");

  const fetchConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const res = await fetch(CONVERSATIONS_API);
      if (!res.ok) throw new Error("获取会话列表失败");
      const data = (await res.json()) as Conversation[];
      setConversations(data);
    } catch (e) {
      console.error("fetchConversations:", e);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadConversation = useCallback(async (id: string) => {
    setCurrentConversationId(id);
    setError(null);
    try {
      const res = await fetch(`${CONVERSATIONS_API}/${id}/messages`);
      if (!res.ok) throw new Error("加载消息失败");
      const list = (await res.json()) as Array<{ id: string; role: string; content: string; citations?: Citation[] }>;
      setMessages(
        list.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          citations: m.citations as Citation[] | undefined,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setMessages([]);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    setCurrentConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm("确定删除该会话？")) return;
      try {
        const res = await fetch(`${CONVERSATIONS_API}/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("删除失败");
        if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
        }
        setConversations((prev) => prev.filter((c) => c.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除失败");
      }
    },
    [currentConversationId]
  );

  const formatConversationDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const flushStreamingContent = useCallback(() => {
    if (pendingChunksRef.current.length === 0) return;
    const chunks = pendingChunksRef.current.splice(0);
    const text = chunks.join("");
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { ...last, content: last.content + text }];
      }
      return prev;
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
    setMessages((prev) => [...prev, userMsg]);

    const assistantId = crypto.randomUUID();
    assistantIdRef.current = assistantId;
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, assistantMsg]);

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

      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user" as const, content: text },
          ],
          ...(queryEmbedding ? { queryEmbedding } : {}),
          ...(currentConversationId ? { conversation_id: currentConversationId } : {}),
        }),
      });

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
              setCurrentConversationId(json.id);
              fetchConversations();
              continue;
            }

            if (json.type === "citations") {
              const citations = json.chunks as Citation[];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, citations } : m
                )
              );
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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "（请求失败）", streaming: false } : m
        )
      );
    } finally {
      stopStreaming();
      setLoading(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
      );
      scrollToBottom();
    }
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* 左侧会话列表 */}
      <aside className="w-56 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
        <div className="p-2 border-b border-slate-100">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full px-3 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            + 新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversationsLoading ? (
            <div className="p-3 text-xs text-slate-400">加载中…</div>
          ) : conversations.length === 0 ? (
            <div className="p-3 text-xs text-slate-400">暂无会话</div>
          ) : (
            <ul className="p-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => loadConversation(c.id)}
                    onKeyDown={(e) => e.key === "Enter" && loadConversation(c.id)}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-left ${
                      currentConversationId === c.id ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <span className="flex-1 min-w-0 truncate text-sm" title={c.title ?? "新对话"}>
                      {c.title?.trim() || "新对话"}
                    </span>
                    <span className="flex-shrink-0 text-xs text-slate-400">
                      {formatConversationDate(c.updated_at)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(c.id, e)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all"
                      title="删除"
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

      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 py-12">输入消息开始对话</div>
          )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            {/* 消息气泡 */}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-slate-200 text-slate-800 shadow-sm"
              }`}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              ) : (
                <div className="prose prose-slate prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-code:bg-slate-100 prose-code:px-1 prose-code:rounded prose-pre:bg-slate-100 prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content || (msg.streaming ? "..." : "")}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {/* 引用来源卡片（仅 assistant 消息，有 citations 时展示）*/}
            {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
              <div className="mt-2 max-w-[80%] w-full">
                <p className="text-xs text-slate-400 mb-1 px-1">参考来源</p>
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

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="flex-shrink-0 p-4 border-t border-slate-200 bg-white">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息..."
            className="flex-1 px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "..." : "发送"}
          </button>
        </div>
      </form>
      </div>
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
