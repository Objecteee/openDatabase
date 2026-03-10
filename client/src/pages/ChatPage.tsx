/**
 * 对话页 — RAG 增强版
 *
 * 发送消息时：
 *   1. 用端侧 embedding 模型将用户输入向量化
 *   2. 将向量随消息一起发送给服务端
 *   3. 服务端执行 RAG（意图分类→混合检索→精排），在流式 token 前先发 citations 事件
 *   4. 前端在 AI 回复气泡下方展示引用来源卡片
 */

import { useState, useRef, useCallback } from "react";
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
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  citations?: Citation[];
}

const API_BASE = "/api";

// ─── 组件 ────────────────────────────────────────────────────────────

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingChunksRef = useRef<string[]>([]);
  const assistantIdRef = useRef<string>("");

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

      // ── 发送请求 ────────────────────────────────────────────────────
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user" as const, content: text },
          ],
          ...(queryEmbedding ? { queryEmbedding } : {}),
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

            // citations 事件：更新引用来源
            if (json.type === "citations") {
              const citations = json.chunks as Citation[];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, citations } : m
                )
              );
              continue;
            }

            // error 事件
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
    <div className="flex flex-1 flex-col min-h-0">
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
  );
}

// ─── 引用来源卡片组件 ─────────────────────────────────────────────────

interface CitationCardProps {
  index: number;
  citation: Citation;
}

function CitationCard({ index, citation }: CitationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = citation.metadata?.summary as string | undefined;
  const keywords = citation.metadata?.keywords as string[] | undefined;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="w-full text-left bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-100 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium flex items-center justify-center">
            {index}
          </span>
          <span className="text-xs text-slate-600 truncate">
            {summary ?? citation.content.slice(0, 60)}
          </span>
        </div>
        <span className="flex-shrink-0 text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span>
      </div>

      {keywords && keywords.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 pl-7">
          {keywords.slice(0, 4).map((kw) => (
            <span key={kw} className="text-xs bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded">
              {kw}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <p className="mt-2 pl-7 text-xs text-slate-500 whitespace-pre-wrap leading-relaxed border-t border-slate-200 pt-2">
          {citation.content}
        </p>
      )}
    </button>
  );
}
