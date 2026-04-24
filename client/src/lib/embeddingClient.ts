/**
 * Embedding 客户端 — 单例 Web Worker 封装
 *
 * 参考: https://github.com/Objecteee/AIGC/tree/main/react-translator
 *
 * Worker 转发 transformers.js 原生进度事件（status: initiate/progress/done/ready/error），
 * 本模块负责聚合为整体进度并暴露给 UI。
 */

import { createUuid } from "./uuid.js";
export const EMBEDDING_DIM = 384;
export type EmbeddingState = "idle" | "loading" | "ready" | "error";

// ─── 内部状态 ───

let worker: Worker | null = null;
let state: EmbeddingState = "idle";
let overallProgress = 0;
let currentFile = "";
let errorMsg: string | null = null;

type StateListener = (s: EmbeddingState, p: number, e: string | null, file?: string) => void;
const listeners = new Set<StateListener>();

interface Pending<T> { resolve: (v: T) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
const pendingEmbeds = new Map<string, Pending<number[]>>();
const pendingBatches = new Map<string, Pending<number[][]>>();
const TIMEOUT_MS = 120_000;

// 按文件聚合字节进度
const fileBytes = new Map<string, { total: number; loaded: number }>();

let notifyScheduled = false;
function notify(immediate = false) {
  if (immediate) {
    listeners.forEach((cb) => cb(state, overallProgress, errorMsg, currentFile));
    return;
  }
  if (notifyScheduled) return;
  notifyScheduled = true;
  requestAnimationFrame(() => {
    notifyScheduled = false;
    listeners.forEach((cb) => cb(state, overallProgress, errorMsg, currentFile));
  });
}

function computeOverall(): number {
  const sumTotal = [...fileBytes.values()].reduce((s, x) => s + x.total, 0);
  const sumLoaded = [...fileBytes.values()].reduce((s, x) => s + Math.min(x.loaded, x.total), 0);
  return sumTotal > 0 ? Math.min(1, sumLoaded / sumTotal) : 0;
}

function makeTimeout<T>(id: string, map: Map<string, Pending<T>>): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const entry = map.get(id);
    if (entry) { map.delete(id); entry.reject(new Error("Embedding 请求超时")); }
  }, TIMEOUT_MS);
}

// ─── Worker 创建（单例）───

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/embedding.worker.ts", import.meta.url), { type: "module" });

  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data;

    // transformers.js 原生进度事件（由 Worker init 阶段转发）
    if (msg.status === "initiate") {
      state = "loading";
      currentFile = msg.file ?? "";
      notify();
      return;
    }
    if (msg.status === "progress") {
      state = "loading";
      const file = msg.file ?? "?";
      if (file !== "?" && typeof msg.loaded === "number" && typeof msg.total === "number" && msg.total > 0) {
        fileBytes.set(file, { total: msg.total, loaded: Math.min(msg.loaded, msg.total) });
      } else if (typeof msg.progress === "number") {
        fileBytes.set(file, { total: 1, loaded: Math.min(1, msg.progress > 1 ? msg.progress / 100 : msg.progress) });
      }
      overallProgress = computeOverall();
      currentFile = file;
      notify();
      return;
    }
    if (msg.status === "done") {
      if (msg.file) fileBytes.delete(msg.file);
      overallProgress = fileBytes.size === 0 ? 1 : computeOverall();
      notify();
      return;
    }
    if (msg.status === "ready") {
      state = "ready";
      overallProgress = 1;
      currentFile = "";
      errorMsg = null;
      fileBytes.clear();
      notify(true);
      return;
    }
    if (msg.status === "error") {
      state = "error";
      errorMsg = msg.error ?? "未知错误";
      notify(true);
      return;
    }

    // embed / embedBatch 结果
    if (msg.type === "embedResult" && msg.id) {
      const p = pendingEmbeds.get(msg.id);
      if (p) { clearTimeout(p.timer); pendingEmbeds.delete(msg.id); p.resolve(msg.embedding ?? []); }
      return;
    }
    if (msg.type === "embedBatchResult" && msg.id) {
      const p = pendingBatches.get(msg.id);
      if (p) { clearTimeout(p.timer); pendingBatches.delete(msg.id); p.resolve(msg.embeddings ?? []); }
      return;
    }
    if (msg.type === "embedError" && msg.id) {
      const err = new Error(msg.error);
      const ps = pendingEmbeds.get(msg.id);
      const pb = pendingBatches.get(msg.id);
      if (ps) { clearTimeout(ps.timer); pendingEmbeds.delete(msg.id); ps.reject(err); }
      if (pb) { clearTimeout(pb.timer); pendingBatches.delete(msg.id); pb.reject(err); }
      return;
    }
  };

  worker.onerror = (err) => {
    state = "error";
    errorMsg = err.message ?? "Worker 内部错误";
    notify();
  };

  return worker;
}

// ─── 公共 API ───

export function initEmbedding(): void {
  if (state === "ready" || state === "loading") return;
  state = "loading";
  overallProgress = 0;
  errorMsg = null;
  fileBytes.clear();
  notify();
  getWorker().postMessage({ type: "init" });
}

export function retryEmbedding(): void {
  state = "idle";
  errorMsg = null;
  overallProgress = 0;
  fileBytes.clear();
  notify();
  initEmbedding();
}

export function subscribeEmbedding(cb: StateListener): () => void {
  listeners.add(cb);
  cb(state, overallProgress, errorMsg, currentFile);
  return () => { listeners.delete(cb); };
}

export function getEmbeddingState() {
  return { state, progress: overallProgress, error: errorMsg };
}

export function embed(text: string): Promise<number[]> {
  const id = createUuid();
  getWorker().postMessage({ type: "embed", id, text });
  return new Promise((resolve, reject) => {
    const timer = makeTimeout(id, pendingEmbeds);
    pendingEmbeds.set(id, { resolve, reject, timer });
  });
}

export function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return Promise.resolve([]);
  const id = createUuid();
  getWorker().postMessage({ type: "embedBatch", id, texts });
  return new Promise((resolve, reject) => {
    const timer = makeTimeout(id, pendingBatches);
    pendingBatches.set(id, { resolve, reject, timer });
  });
}
