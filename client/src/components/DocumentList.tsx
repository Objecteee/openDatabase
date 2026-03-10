/**
 * 文档列表：名称、类型、大小、状态、操作
 */

import { useState, useEffect } from "react";
import { vectorizeDocument } from "../lib/vectorizeService.js";

const API_BASE = "/api/documents";

export interface Document {
  id: string;
  name: string;
  type: string;
  size: number;
  status: string;
  created_at: string;
}

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "待处理", color: "text-amber-600" },
  processing: { label: "处理中", color: "text-blue-600" },
  completed: { label: "已完成", color: "text-green-600" },
  failed: { label: "失败", color: "text-red-600" },
};

const typeIcons: Record<string, string> = {
  pdf: "📄",
  txt: "📝",
  md: "📝",
  docx: "📄",
  video: "🎬",
  audio: "🎵",
  unknown: "📎",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface DocumentListProps {
  refreshTrigger?: number;
  embeddingReady?: boolean;
}

export function DocumentList({ refreshTrigger = 0, embeddingReady = false }: DocumentListProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vectorizingId, setVectorizingId] = useState<string | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res = await fetch(API_BASE);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setDocs(data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [refreshTrigger]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除「${name}」？`)) return;
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleVectorize = async (id: string) => {
    setVectorizingId(id);
    try {
      const res = await vectorizeDocument(id);
      if (res.ok) {
        await fetchDocs();
      } else {
        alert(res.error ?? "向量化失败");
      }
    } finally {
      setVectorizingId(null);
    }
  };

  const handlePreview = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/${id}/url`);
      if (!res.ok) throw new Error("获取预览链接失败");
      const { url } = await res.json();
      if (url) window.open(url, "_blank");
    } catch (e) {
      alert(e instanceof Error ? e.message : "预览失败");
    }
  };

  if (loading && docs.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500">
        加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-600">
        {error}
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500">
        暂无文档
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 font-medium text-slate-700">名称</th>
              <th className="px-4 py-3 font-medium text-slate-700">类型</th>
              <th className="px-4 py-3 font-medium text-slate-700">大小</th>
              <th className="px-4 py-3 font-medium text-slate-700">状态</th>
              <th className="px-4 py-3 font-medium text-slate-700">时间</th>
              <th className="px-4 py-3 font-medium text-slate-700 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const status = statusMap[doc.status] ?? { label: doc.status, color: "text-slate-600" };
              const icon = typeIcons[doc.type] ?? typeIcons.unknown;
              return (
                <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span
                      className="cursor-pointer truncate max-w-xs inline-block text-indigo-600 hover:underline"
                      onClick={() => handlePreview(doc.id)}
                    >
                      {doc.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span title={doc.type}>{icon} {doc.type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatSize(doc.size)}</td>
                  <td className={`px-4 py-3 ${status.color}`}>{status.label}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(doc.created_at)}</td>
                  <td className="px-4 py-3">
                    {["txt", "md", "pdf"].includes(doc.type) && doc.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => handleVectorize(doc.id)}
                        disabled={!!vectorizingId || !embeddingReady}
                        title={!embeddingReady ? "向量化模型加载中，请稍候" : undefined}
                        className="mr-3 text-indigo-600 hover:underline disabled:opacity-50"
                      >
                        {vectorizingId === doc.id ? "向量化中…" : embeddingReady ? "向量化" : "向量化(加载中)"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id, doc.name)}
                      className="text-red-600 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
