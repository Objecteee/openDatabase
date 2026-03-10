/**
 * Embedding 客户端：单例 Web Worker，负责模型加载与向量化
 * 仅在 Worker 内加载一次模型，主线程通过 postMessage 通信
 */

export const EMBEDDING_DIM = 384;

export type EmbeddingState = "idle" | "loading" | "ready" | "error";

export interface EmbeddingInitProgress {
  progress: number;
  file?: string;
  status?: string;
}

type WorkerMessage =
  | { type: "progress"; progress: number; file?: string; status?: string }
  | { type: "ready" }
  | { type: "error"; error: string }
  | { type: "embedResult"; id?: string; embedding: number[] }
  | { type: "embedBatchResult"; id?: string; embeddings: number[][] }
  | { type: "embedError"; id?: string; error: string };

let worker: Worker | null = null;
let state: EmbeddingState = "idle";
let progress = 0;
let currentFile = "";
let errorMsg: string | null = null;
const listeners = new Set<(s: EmbeddingState, p: number, e: string | null, file?: string) => void>();
const pendingEmbeds = new Map<string, { resolve: (v: number[]) => void; reject: (e: Error) => void }>();
const pendingBatches = new Map<string, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();

function notify() {
  listeners.forEach((cb) => cb(state, progress, errorMsg, currentFile));
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/embedding.worker.ts", import.meta.url), { type: "module" });
  console.warn("[Embedding] Worker 已创建，等待模型加载…");
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    switch (msg.type) {
      case "progress":
        progress = Math.min(1, Math.max(0, msg.progress));
        currentFile = msg.file ?? "";
        state = "loading";
        console.warn("[Embedding] 进度:", `${(progress * 100).toFixed(1)}%`, msg.file ?? "");
        notify();
        break;
      case "ready":
        state = "ready";
        progress = 1;
        currentFile = "";
        errorMsg = null;
        console.warn("[Embedding] 模型就绪");
        notify();
        break;
      case "error":
        state = "error";
        errorMsg = msg.error;
        notify();
        break;
      case "embedResult":
        if (msg.id) {
          const p = pendingEmbeds.get(msg.id);
          if (p) {
            pendingEmbeds.delete(msg.id);
            p.resolve(msg.embedding ?? []);
          }
        }
        break;
      case "embedBatchResult":
        if (msg.id) {
          const p = pendingBatches.get(msg.id);
          if (p) {
            pendingBatches.delete(msg.id);
            p.resolve(msg.embeddings ?? []);
          }
        }
        break;
      case "embedError":
        if (msg.id) {
          const err = new Error(msg.error);
          pendingEmbeds.get(msg.id)?.reject(err);
          pendingBatches.get(msg.id)?.reject(err);
          pendingEmbeds.delete(msg.id);
          pendingBatches.delete(msg.id);
        }
        break;
      default:
        break;
    }
  };
  worker.onerror = (err) => {
    state = "error";
    errorMsg = err.message ?? "Worker 错误";
    notify();
  };
  return worker;
}

export function initEmbedding(): void {
  if (state === "ready") {
    console.log("[Embedding] 已就绪，跳过初始化");
    return;
  }
  if (state === "loading") return;
  console.log("[Embedding] 触发初始化");
  state = "loading";
  progress = 0;
  errorMsg = null;
  notify();
  getWorker().postMessage({ type: "init" });
}

export function subscribeEmbedding(cb: (s: EmbeddingState, p: number, e: string | null, file?: string) => void): () => void {
  listeners.add(cb);
  cb(state, progress, errorMsg, currentFile);
  return () => {
    listeners.delete(cb);
  };
}

export function getEmbeddingState(): { state: EmbeddingState; progress: number; error: string | null } {
  return { state, progress, error: errorMsg };
}

export function embed(text: string): Promise<number[]> {
  const id = crypto.randomUUID();
  getWorker().postMessage({ type: "embed", id, text });
  return new Promise((resolve, reject) => {
    pendingEmbeds.set(id, { resolve, reject });
  });
}

export function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return Promise.resolve([]);
  const id = crypto.randomUUID();
  getWorker().postMessage({ type: "embedBatch", id, texts });
  return new Promise((resolve, reject) => {
    pendingBatches.set(id, { resolve, reject });
  });
}
