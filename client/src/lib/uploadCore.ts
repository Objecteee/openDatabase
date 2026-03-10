/**
 * 上传核心逻辑：可被 useFileUpload / useMultiFileUpload 复用
 */

import { CHUNK_SIZE, SMALL_FILE_THRESHOLD, MAX_CONCURRENT_CHUNKS } from "../constants/upload.js";

const API_BASE = "/api/documents";
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

function safeParseJson<T>(res: Response): Promise<T> {
  return res.json().catch(() => ({})) as Promise<T>;
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

  let checkRes: Response;
  try {
    checkRes = await fetch(`${API_BASE}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash }),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "网络错误" };
  }

  const checkJson = (await safeParseJson<{ exists?: boolean; id?: string; error?: string }>(checkRes));
  if (checkRes.ok && checkJson.exists && checkJson.id) {
    onProgress?.({ phase: "done", progress: 1 });
    return { documentId: checkJson.id };
  }
  if (!checkRes.ok) {
    return { error: checkJson.error || "秒传检查失败" };
  }

  onProgress?.({ phase: "uploading", progress: 0 });

  if (file.size < SMALL_FILE_THRESHOLD) {
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("hash", hash);
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
      const json = await safeParseJson<{ id?: string; error?: string }>(res);
      if (!res.ok) return { error: json.error || "上传失败" };
      onProgress?.({ phase: "done", progress: 1 });
      return { documentId: json.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "上传失败" };
    }
  }

  let initRes: Response;
  try {
    initRes = await fetch(`${API_BASE}/upload/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, hash }),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "网络错误" };
  }

  const initJson = await safeParseJson<{ upload_id?: string; total_chunks?: number; error?: string }>(initRes);
  if (!initRes.ok) return { error: initJson.error || "初始化失败" };
  const { upload_id, total_chunks } = initJson;
  if (!upload_id || typeof total_chunks !== "number") return { error: "服务端返回格式异常" };
  if (!UUID_REGEX.test(upload_id)) return { error: "服务端返回的 upload_id 无效" };

  let received = new Set<number>();
  try {
    const statusRes = await fetch(`${API_BASE}/upload/status/${upload_id}`);
    if (statusRes.ok) {
      const statusJson = await safeParseJson<{ received?: number[] }>(statusRes);
      received = new Set(statusJson.received ?? []);
    }
  } catch {
    /* ignore */
  }

  const toUpload = Array.from({ length: total_chunks }, (_, i) => i).filter((i) => !received.has(i));
  let uploaded = received.size;

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
      const err = await safeParseJson<{ error?: string }>(res);
      throw new Error(err.error || `分片 ${index} 上传失败`);
    }
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

  let completeRes: Response;
  try {
    completeRes = await fetch(`${API_BASE}/upload/complete/${upload_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name }),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "网络错误" };
  }

  const completeJson = await safeParseJson<{ id?: string; error?: string }>(completeRes);
  if (!completeRes.ok) return { error: completeJson.error || "合并失败" };
  onProgress?.({ phase: "done", progress: 1 });
  return { documentId: completeJson.id };
}
