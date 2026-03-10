/**
 * Embedding Web Worker — 单例模式
 *
 * 参考: https://github.com/Objecteee/AIGC/tree/main/react-translator
 *
 * 使用 Singleton Pattern 确保 pipeline 只加载一次（存的是 Promise 本身）。
 * 首次调用 getInstance 触发加载，后续调用直接返回同一 Promise。
 */

import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

// ─── 环境配置（必须在 pipeline() 调用前完成）───

env.allowLocalModels = false;

const onnxEnv = env.backends.onnx as Record<string, Record<string, unknown>>;
if (onnxEnv?.wasm) {
  onnxEnv.wasm.numThreads = 1;
  onnxEnv.wasm.wasmPaths =
    "https://cdn.jsdmirror.com/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";
}

// ─── 单例 Pipeline ───

class EmbeddingPipeline {
  static model = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
  static instance: Promise<FeatureExtractionPipeline> | null = null;

  static getInstance(
    progress_callback?: (p: Record<string, unknown>) => void,
  ): Promise<FeatureExtractionPipeline> {
    if (this.instance === null) {
      // @ts-expect-error pipeline 联合类型过于复杂
      this.instance = pipeline("feature-extraction", this.model, {
        progress_callback,
        dtype: "q8",
        device: "wasm",
      });
      this.instance.catch(() => {
        this.instance = null;
      });
    }
    return this.instance;
  }
}

// ─── 辅助函数 ───

function extractVector(raw: unknown): number[] {
  if (Array.isArray(raw)) return (raw[0] as number[]) ?? [];
  const t = raw as { data: Float32Array };
  return Array.from(t.data);
}

// ─── 消息监听 ───

self.addEventListener("message", async (event) => {
  const { type, id, text, texts } = event.data;

  if (type === "init") {
    try {
      await EmbeddingPipeline.getInstance((x) => {
        self.postMessage(x);
      });
      self.postMessage({ status: "ready" });
    } catch (err) {
      self.postMessage({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (type === "embed" && id !== undefined && text !== undefined) {
    try {
      const pipe = await EmbeddingPipeline.getInstance();
      const out = await pipe(text, { pooling: "mean", normalize: true });
      self.postMessage({ type: "embedResult", id, embedding: extractVector(out) });
    } catch (err) {
      self.postMessage({ type: "embedError", id, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (type === "embedBatch" && id !== undefined && texts?.length) {
    try {
      const pipe = await EmbeddingPipeline.getInstance();
      const results: number[][] = [];
      for (const t of texts) {
        const out = await pipe(t, { pooling: "mean", normalize: true });
        results.push(extractVector(out));
      }
      self.postMessage({ type: "embedBatchResult", id, embeddings: results });
    } catch (err) {
      self.postMessage({ type: "embedError", id, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
});
