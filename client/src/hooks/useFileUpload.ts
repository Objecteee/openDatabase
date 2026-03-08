/**
 * 大文件上传 Hook
 * Web Worker MD5 → 秒传 → 小文件直传 / 大文件分片（并发 6、断点续传）
 */

import { useState, useCallback } from "react";

const API_BASE = "/api/documents";
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB，与后端一致
const SMALL_THRESHOLD = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT = 6;

export type UploadPhase = "idle" | "hashing" | "checking" | "uploading" | "done" | "error";

export interface UploadState {
  phase: UploadPhase;
  progress: number; // 0..1
  hashProgress?: number; // 0..1, 仅 hashing 时有意义
  error?: string;
  documentId?: string;
}

export function useFileUpload() {
  const [state, setState] = useState<UploadState>({ phase: "idle", progress: 0 });

  const computeHash = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../workers/hash.worker.ts", import.meta.url), { type: "module" });
      worker.postMessage({ file });
      worker.onmessage = (e: MessageEvent<{ hash?: string; error?: string; progress?: number }>) => {
        const { hash, error, progress } = e.data;
        if (error) {
          worker.terminate();
          reject(new Error(error));
          return;
        }
        if (progress !== undefined) {
          setState((s) => (s.phase === "hashing" ? { ...s, hashProgress: progress } : s));
        }
        if (hash) {
          worker.terminate();
          resolve(hash);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error("Hash worker 错误"));
      };
    });
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setState({ phase: "hashing", progress: 0, hashProgress: 0 });

      let hash: string;
      try {
        hash = await computeHash(file);
      } catch (e) {
        setState({ phase: "error", progress: 0, error: e instanceof Error ? e.message : "Hash 计算失败" });
        return;
      }

      setState({ phase: "checking", progress: 0 });

      // 秒传
      const checkRes = await fetch(`${API_BASE}/check-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      const checkJson = (await checkRes.json()) as { exists?: boolean; id?: string };
      if (checkJson.exists && checkJson.id) {
        setState({ phase: "done", progress: 1, documentId: checkJson.id });
        return;
      }

      setState({ phase: "uploading", progress: 0 });

      if (file.size < SMALL_THRESHOLD) {
        // 小文件直传
        const form = new FormData();
        form.append("file", file);
        form.append("hash", hash);
        const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setState({ phase: "error", progress: 0, error: (err as { error?: string }).error || "上传失败" });
          return;
        }
        const json = (await res.json()) as { id?: string };
        setState({ phase: "done", progress: 1, documentId: json.id });
        return;
      }

      // 大文件分片
      const initRes = await fetch(`${API_BASE}/upload/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, hash }),
      });
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}));
        setState({ phase: "error", progress: 0, error: (err as { error?: string }).error || "初始化失败" });
        return;
      }
      const { upload_id, total_chunks } = (await initRes.json()) as { upload_id: string; total_chunks: number };

      // 断点续传：查询已传分片
      let received = new Set<number>();
      try {
        const statusRes = await fetch(`${API_BASE}/upload/status/${upload_id}`);
        if (statusRes.ok) {
          const statusJson = (await statusRes.json()) as { received?: number[] };
          received = new Set(statusJson.received ?? []);
        }
      } catch {
        /* ignore */
      }

      const toUpload = Array.from({ length: total_chunks }, (_, i) => i).filter((i) => !received.has(i));
      let uploaded = received.size;
      const total = total_chunks;

      const uploadChunk = async (index: number) => {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);
        const res = await fetch(`${API_BASE}/upload/chunk/${upload_id}/${index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `分片 ${index} 上传失败`);
        }
        uploaded++;
        setState((s) => ({ ...s, progress: uploaded / total }));
      };

      // 并发 6 上传分片
      let nextIdx = 0;
      const runNext = async (): Promise<void> => {
        if (nextIdx >= toUpload.length) return;
        const idx = toUpload[nextIdx++];
        await uploadChunk(idx);
        return runNext();
      };
      const workers = Array.from({ length: Math.min(MAX_CONCURRENT, toUpload.length) }, () => runNext());
      await Promise.all(workers);

      const completeRes = await fetch(`${API_BASE}/upload/complete/${upload_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name }),
      });
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        setState({ phase: "error", progress: 0, error: (err as { error?: string }).error || "合并失败" });
        return;
      }
      const completeJson = (await completeRes.json()) as { id?: string };
      setState({ phase: "done", progress: 1, documentId: completeJson.id });
    },
    [computeHash]
  );

  const reset = useCallback(() => {
    setState({ phase: "idle", progress: 0 });
  }, []);

  return { state, upload, reset };
}
