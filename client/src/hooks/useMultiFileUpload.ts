/**
 * 多文件上传 Hook：队列 + 并发控制（与 main.mdc 规范一致：并发 6）
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { performUpload, type UploadProgress } from "../lib/uploadCore.js";
import { createUuid } from "../lib/uuid.js";

export type UploadPhase = "queued" | "hashing" | "checking" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  file: File;
  phase: UploadPhase;
  progress: number;
  hashProgress?: number;
  error?: string;
  documentId?: string;
}

const MAX_CONCURRENT = 6;

/** 单个上传项完成时调用，若上传成功则传入新文档 ID */
export function useMultiFileUpload(onItemDone?: (documentId?: string) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const onItemDoneRef = useRef(onItemDone);
  onItemDoneRef.current = onItemDone;

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const processQueue = useCallback(() => {
    const queued = items.filter((it) => it.phase === "queued");
    const active = items.filter((it) => ["hashing", "checking", "uploading"].includes(it.phase));
    if (queued.length === 0 || active.length >= MAX_CONCURRENT) return;

    const toStart = queued.slice(0, MAX_CONCURRENT - active.length);
    toStart.forEach((item) => {
      updateItem(item.id, { phase: "hashing" });
      performUpload(item.file, (p: UploadProgress) => {
        updateItem(item.id, {
          phase: p.phase,
          progress: p.progress,
          hashProgress: p.hashProgress,
        });
      })
        .then((result) => {
          if (result.documentId) {
            updateItem(item.id, { phase: "done", progress: 1, documentId: result.documentId });
            onItemDoneRef.current?.(result.documentId);
          } else {
            updateItem(item.id, { phase: "error", progress: 0, error: result.error });
            onItemDoneRef.current?.();
          }
        })
        .catch((e) => {
          updateItem(item.id, {
            phase: "error",
            progress: 0,
            error: e instanceof Error ? e.message : "上传失败",
          });
          onItemDoneRef.current?.();
        });
    });
  }, [items, updateItem]);

  useEffect(() => {
    processQueue();
  }, [items, processQueue]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.isArray(files) ? files : Array.from(files);
    const validFiles = arr.filter((f) => f.size > 0);
    if (validFiles.length === 0) return;
    const newItems: UploadItem[] = validFiles.map((file) => ({
      id: createUuid(),
      file,
      phase: "queued" as const,
      progress: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.phase !== "done" && it.phase !== "error"));
  }, []);

  return { items, addFiles, removeItem, clearCompleted };
}
