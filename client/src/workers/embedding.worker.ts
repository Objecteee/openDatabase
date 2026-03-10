/**
 * Web Worker: 加载 Embedding 模型并推理，单例模式（Worker 内仅加载一次）
 * 使用 @huggingface/transformers feature-extraction，不阻塞主线程
 * 模型缓存到浏览器 Cache API，刷新页面从缓存加载，无需重新下载
 */

import { pipeline, env } from "@huggingface/transformers";

console.log("[Embedding Worker] 脚本已加载");

// 必须在 pipeline 调用前设置，确保刷新后从缓存加载
// 使用 customCache 包装以便诊断 HIT/MISS 及捕获 QuotaExceededError
let cachePromise: Promise<Cache> | null = null;
async function getCache(): Promise<Cache> {
  if (!cachePromise && typeof caches !== "undefined") {
    cachePromise = caches.open("transformers-cache");
  }
  if (!cachePromise) throw new Error("Cache API 不可用");
  return cachePromise;
}

if (typeof (caches as unknown)?.open === "function") {
  env.useCustomCache = true;
  env.customCache = {
    async match(key: RequestInfo | string) {
      const c = await getCache();
      const r = await c.match(key);
      const label = typeof key === "string" ? key.replace(/^https?:\/\/[^/]+/, "").slice(-50) : "?";
      console.warn(r ? `[Embedding Worker] Cache HIT ${label}` : `[Embedding Worker] Cache MISS ${label}`);
      return r ?? undefined;
    },
    async put(key: RequestInfo | URL, value: Response | BodyInit, _progressCallback?: (d: unknown) => void) {
      const c = await getCache();
      try {
        await c.put(key, value as Response); // 标准 Cache API 仅支持 key/value，progress 由库内部处理
        const label = typeof key === "string" ? key.replace(/^https?:\/\/[^/]+/, "").slice(-50) : "?";
        console.warn(`[Embedding Worker] Cache PUT OK ${label}`);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "QuotaExceededError") {
          console.error(
            "[Embedding Worker] 缓存写入失败：存储空间不足 (QuotaExceeded)。请退出无痕模式、清理站点数据或使用生产构建测试。"
          );
        }
        throw e;
      }
    },
  };
} else {
  env.useBrowserCache = true;
  console.warn("[Embedding Worker] Cache API 不可用，fallback 到默认缓存");
}

// 启动时检查缓存：若上次有写入，刷新后 keys 应非空
if (env.useCustomCache) {
  getCache()
    .then((c) => c.keys())
    .then((keys) => console.warn(`[Embedding Worker] transformers-cache 当前条目数: ${keys.length}`))
    .catch(() => {});
}

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

type LoadProgress = { loaded?: number; total?: number; progress?: number; file?: string; status?: string };

let pipe: ((text: string, opts?: object) => Promise<unknown>) | null = null;
let initPromise: Promise<void> | null = null;

// 按字节加权的整体进度：loadedBytes/totalBytes，单条进度条代表整个模型
const fileBytes = new Map<string, { total: number; loaded: number }>();

function toVector(output: { data: Float32Array; dims: number[] } | number[]): number[] {
  if (Array.isArray(output)) return output;
  return Array.from(output.data);
}

async function ensureLoaded(): Promise<void> {
  if (pipe) return;
  if (initPromise) return initPromise;
  const progressCb = (p: LoadProgress) => {
    let total = 0;
    let loaded = 0;
    if (typeof p.loaded === "number" && typeof p.total === "number" && p.total > 0) {
      total = p.total;
      loaded = Math.min(p.loaded, p.total);
    } else if (typeof p.progress === "number") {
      const prog = Math.min(1, p.progress > 1 ? p.progress / 100 : p.progress);
      loaded = prog;
      total = 1;
    }
    const f = p.file ?? "?";
    if (f !== "?" && total > 0) {
      fileBytes.set(f, { total, loaded });
    }
    // 整体进度 = 已下载字节 / 总字节（所有文件的累加）
    const totalBytes = [...fileBytes.values()].reduce((s, x) => s + x.total, 0);
    const loadedBytes = [...fileBytes.values()].reduce((s, x) => s + Math.min(x.loaded, x.total), 0);
    const overall = totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 0;
    const pct = Math.min(100, overall * 100);
    console.warn(`[Embedding Worker] 模型下载进度: ${pct.toFixed(1)}%`);
    self.postMessage({ type: "progress", progress: overall, file: p.file, status: p.status });
  };
  console.warn("[Embedding Worker] 开始加载模型:", MODEL_ID);
  fileBytes.clear();
  initPromise = (async () => {
    try {
      const loaded = await pipeline("feature-extraction", MODEL_ID, {
        progress_callback: progressCb,
        dtype: "q8", // 显式指定，消除 "dtype not specified" 警告
      });
      pipe = loaded as (text: string, opts?: object) => Promise<unknown>;
      console.warn("[Embedding Worker] 模型加载完成");
      self.postMessage({ type: "ready" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Embedding] 模型加载失败:", errMsg);
      self.postMessage({ type: "error", error: errMsg });
      initPromise = null;
    }
  })();
  return initPromise;
}

self.onmessage = async (e: MessageEvent<{ type: string; id?: string; text?: string; texts?: string[] }>) => {
  const { type, id, text, texts } = e.data;
  if (type === "init") {
    console.log("[Embedding Worker] 收到 init，开始加载…");
    await ensureLoaded();
    return;
  }
  if (type === "embed" && text !== undefined) {
    await ensureLoaded();
    if (!pipe) return;
    try {
      const out = (await pipe(text, { pooling: "mean", normalize: true })) as
        | { data: Float32Array; dims: number[] }
        | number[][];
      const vec = Array.isArray(out) ? (out[0] as number[]) ?? [] : toVector(out);
      self.postMessage({ type: "embedResult", id, embedding: vec });
    } catch (err) {
      self.postMessage({ type: "embedError", id, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (type === "embedBatch" && texts?.length) {
    await ensureLoaded();
    if (!pipe) return;
    try {
      const results: number[][] = [];
      for (const t of texts) {
        const out = (await pipe(t, { pooling: "mean", normalize: true })) as
          | { data: Float32Array; dims: number[] }
          | number[][];
        const vec = Array.isArray(out) ? (out[0] as number[]) ?? [] : toVector(out);
        results.push(vec);
      }
      self.postMessage({ type: "embedBatchResult", id, embeddings: results });
    } catch (err) {
      self.postMessage({ type: "embedError", id, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
};
