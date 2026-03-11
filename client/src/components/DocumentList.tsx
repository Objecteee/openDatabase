/**
 * 文档列表：名称、类型、大小、状态、操作
 */

import { useState, useEffect } from "react";
import { vectorizeDocument } from "../lib/vectorizeService.js";
import { useDocumentsStore } from "../stores/documentsStore.js";
import { useTranslation } from "react-i18next";
import styles from "./DocumentList.module.scss";

export interface Document {
  id: string;
  name: string;
  type: string;
  size: number;
  status: string;
  created_at: string;
}

const statusMap: Record<string, { label: string; tone: "pending" | "processing" | "completed" | "failed" }> = {
  pending: { label: "待处理", tone: "pending" },
  processing: { label: "处理中", tone: "processing" },
  completed: { label: "已完成", tone: "completed" },
  failed: { label: "失败", tone: "failed" },
};

const typeIcons: Record<string, string> = {
  pdf: "📄",
  txt: "📝",
  md: "📝",
  docx: "📄",
  xlsx: "📊",
  xls: "📊",
  pptx: "📊",
  csv: "📊",
  json: "📋",
  html: "🌐",
  xml: "📋",
  jpg: "🖼️",
  jpeg: "🖼️",
  png: "🖼️",
  video: "🎬",
  audio: "🎵",
  unknown: "📎",
};

/** 不支持向量化的类型（unknown 等） */
const NON_VECTORIZABLE = new Set(["unknown"]);

/** 向量化耗时较长的类型，显示额外提示 */
const SLOW_TYPES = new Set(["video", "audio"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
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
  const { i18n } = useTranslation();
  const docs = useDocumentsStore((s) => s.docs) as unknown as Document[];
  const loading = useDocumentsStore((s) => s.loading);
  const error = useDocumentsStore((s) => s.error);
  const fetchDocs = useDocumentsStore((s) => s.fetchDocs);
  const deleteDoc = useDocumentsStore((s) => s.deleteDoc);
  const getPreviewUrl = useDocumentsStore((s) => s.getPreviewUrl);
  const [vectorizingId, setVectorizingId] = useState<string | null>(null);

  useEffect(() => {
    fetchDocs();
  }, [refreshTrigger]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除「${name}」？`)) return;
    try {
      await deleteDoc(id);
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
      const url = await getPreviewUrl(id);
      if (url) window.open(url, "_blank");
    } catch (e) {
      alert(e instanceof Error ? e.message : "预览失败");
    }
  };

  if (loading && docs.length === 0) {
    return (
      <div className={styles.empty}>加载中…</div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>{error}</div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className={styles.empty}>暂无文档</div>
    );
  }

  return (
    <>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.thead}>
              <th className={styles.th}>名称</th>
              <th className={`${styles.th} ${styles.thHideMobile}`}>类型</th>
              <th className={`${styles.th} ${styles.thHideMobile}`}>大小</th>
              <th className={styles.th}>状态</th>
              <th className={`${styles.th} ${styles.thHideMobile}`}>时间</th>
              <th className={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const status = statusMap[doc.status] ?? { label: doc.status, tone: "pending" as const };
              const icon = typeIcons[doc.type] ?? typeIcons.unknown;
              const badgeClass =
                status.tone === "pending"
                  ? styles.badgePending
                  : status.tone === "processing"
                    ? styles.badgeProcessing
                    : status.tone === "completed"
                      ? styles.badgeCompleted
                      : styles.badgeFailed;
              return (
                <tr key={doc.id} className={styles.tr}>
                  <td className={styles.td}>
                    <span
                      className={styles.nameLink}
                      onClick={() => handlePreview(doc.id)}
                    >
                      {doc.name}
                    </span>
                  </td>
                  <td className={`${styles.td} ${styles.tdHideMobile}`}>
                    <span title={doc.type}>{icon} {doc.type}</span>
                  </td>
                  <td className={`${styles.td} ${styles.tdHideMobile} ${styles.muted}`}>{formatSize(doc.size)}</td>
                  <td className={styles.td}>
                    <span className={`${styles.badge} ${badgeClass}`}>{status.label}</span>
                  </td>
                  <td className={`${styles.td} ${styles.tdHideMobile} ${styles.muted}`}>
                    {formatDate(doc.created_at, i18n.language)}
                  </td>
                  <td className={styles.td}>
                    {!NON_VECTORIZABLE.has(doc.type) && doc.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => handleVectorize(doc.id)}
                        disabled={!!vectorizingId || !embeddingReady}
                        title={
                          !embeddingReady
                            ? "向量化模型加载中，请稍候"
                            : SLOW_TYPES.has(doc.type)
                              ? `${doc.type === "video" ? "视频理解" : "语音识别"}耗时较长，请耐心等待`
                              : undefined
                        }
                        className={styles.actionLink}
                      >
                        {vectorizingId === doc.id
                          ? "处理中…"
                          : !embeddingReady
                            ? "向量化(加载中)"
                            : "向量化"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id, doc.name)}
                      className={styles.dangerLink}
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
