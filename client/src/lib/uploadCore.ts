/**
 * 上传核心逻辑：可被 useFileUpload / useMultiFileUpload 复用
 */

import { CHUNK_SIZE, SMALL_FILE_THRESHOLD, MAX_CONCURRENT_CHUNKS } from "../constants/upload.js";
import { api } from "./apiClient.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UploadPhase = "hashing" | "checking" | "uploading" | "done" | "error";

export interface UploadProgress {
  phase: UploadPhase;
  progress: number;
  hashProgress?: number;
}

export interface UploadResult {
  documentId?: string;
  error?: string;
}

function computeHashInWorker(file: File, onProgress?: (p: number) => void): Promise<string> {
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
      if (progress !== undefined) onProgress?.(progress);
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
}

function normalizeError(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message?: unknown }).message === "string") {
    return String((e as { message: string }).message);
  }
  return fallback;
}

export async function performUpload(
  file: File,
  onProgress?: (p: UploadProgress) => void
): Promise<UploadResult> {
  if (file.size === 0) return { error: "不允许上传空文件" };

  onProgress?.({ phase: "hashing", progress: 0, hashProgress: 0 });

  let hash: string;
  try {
    hash = await computeHashInWorker(file, (p) => onProgress?.({ phase: "hashing", progress: 0, hashProgress: p }));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Hash 计算失败" };
  }

  onProgress?.({ phase: "checking", progress: 0 });

  try {
    const checkRes = await api.post("/documents/check-upload", { hash });
    const checkJson = checkRes.data as { exists?: boolean; id?: string };
    if (checkJson.exists && checkJson.id) {
      onProgress?.({ phase: "done", progress: 1 });
      return { documentId: checkJson.id };
    }
  } catch (e) {
    // 秒传检查失败可继续走上传（不直接失败）
  }

  onProgress?.({ phase: "uploading", progress: 0 });

  if (file.size < SMALL_FILE_THRESHOLD) {
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("hash", hash);
      const res = await api.post("/documents/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const json = res.data as { id?: string };
      onProgress?.({ phase: "done", progress: 1 });
      return { documentId: json.id };
    } catch (e) {
      return { error: normalizeError(e, "上传失败") };
    }
  }

  try {
    const initRes = await api.post("/documents/upload/init", { name: file.name, size: file.size, hash });
    const initJson = initRes.data as { upload_id?: string; total_chunks?: number };
    const { upload_id, total_chunks } = initJson;
    if (!upload_id || typeof total_chunks !== "number") return { error: "服务端返回格式异常" };
    if (!UUID_REGEX.test(upload_id)) return { error: "服务端返回的 upload_id 无效" };

    let received = new Set<number>();
    try {
      const statusRes = await api.get(`/documents/upload/status/${upload_id}`);
      const statusJson = statusRes.data as { received?: number[] };
      received = new Set(statusJson.received ?? []);
    } catch {
      /* ignore */
    }

    const toUpload = Array.from({ length: total_chunks }, (_, i) => i).filter((i) => !received.has(i));
    let uploaded = received.size;

    const uploadChunk = async (index: number) => {
      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);
      await api.put(`/documents/upload/chunk/${upload_id}/${index}`, blob, {
        headers: { "Content-Type": "application/octet-stream" },
      });
      uploaded++;
      onProgress?.({ phase: "uploading", progress: uploaded / total_chunks });
    };

    let nextIdx = 0;
    const runNext = async (): Promise<void> => {
      if (nextIdx >= toUpload.length) return;
      const idx = toUpload[nextIdx++];
      await uploadChunk(idx);
      return runNext();
    };
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, toUpload.length) }, () => runNext());
    await Promise.all(workers);

    const completeRes = await api.post(`/documents/upload/complete/${upload_id}`, { name: file.name });
    const completeJson = completeRes.data as { id?: string };
    onProgress?.({ phase: "done", progress: 1 });
    return { documentId: completeJson.id };
  } catch (e) {
    return { error: normalizeError(e, "上传失败") };
  }
}
