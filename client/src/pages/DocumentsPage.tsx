/**
 * 文档库页：上传 + 列表
 * 向量化模型加载完成前不进入主内容，全屏显示加载进度条
 */

import { useState, useEffect, useRef } from "react";
import { useEmbeddingModel } from "../hooks/useEmbeddingModel.js";
import { useMultiFileUpload } from "../hooks/useMultiFileUpload.js";
import { MultiFileUploadZone } from "../components/MultiFileUploadZone.js";
import { DocumentList } from "../components/DocumentList.js";
import { vectorizeDocument } from "../lib/vectorizeService.js";

const INITIALIZING_DELAY_MS = 2000;
const TIMEOUT_MS = 60_000;
const PHASE_CHECK_INTERVAL_MS = 1000;

type LoadPhase = "downloading" | "initializing" | "timeout";

export function DocumentsPage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { isReady, isError, progress, currentFile, error, retry } = useEmbeddingModel();
  // 上传成功（含直传、分片、秒传）后必触发一次自动向量化，不区分文件类型；解析失败则文档保持 pending 可手动重试
  const { items, addFiles, removeItem, clearCompleted } = useMultiFileUpload((documentId) => {
    setRefreshTrigger((t) => t + 1);
    if (documentId) {
      vectorizeDocument(documentId).finally(() => setRefreshTrigger((t) => t + 1));
    }
  });
  const [phase, setPhase] = useState<LoadPhase>("downloading");
  const highProgressSinceRef = useRef<number | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // 阶段检测：用 setInterval 轮询，通过 ref 读取最新 progress 避免频繁重建 effect
  useEffect(() => {
    if (isReady || isError) return;

    function checkPhase() {
      if (progressRef.current >= 0.99) {
        if (highProgressSinceRef.current === null) highProgressSinceRef.current = Date.now();
        const elapsed = Date.now() - highProgressSinceRef.current;
        if (elapsed >= TIMEOUT_MS) setPhase("timeout");
        else if (elapsed >= INITIALIZING_DELAY_MS) setPhase("initializing");
      } else {
        highProgressSinceRef.current = null;
        setPhase("downloading");
      }
    }

    checkPhase();
    const id = setInterval(checkPhase, PHASE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isReady, isError]);

  // 模型加载中
  if (!isReady && !isError) {
    const statusText =
      phase === "timeout"
        ? "加载超时，请重试或检查网络"
        : phase === "initializing"
          ? "正在初始化模型，请稍候…"
          : currentFile || "首次使用需下载约 100MB，请耐心等待";

    return (
      <div className="flex flex-1 flex-col min-h-0 items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md">
          <h2 className="text-lg font-medium text-slate-700 mb-2">向量化模型加载中</h2>
          <p className="text-sm text-slate-500 mb-4">{statusText}</p>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {phase === "timeout" ? "超时" : `${Math.round(progress * 100)}%`}
          </p>
          {phase === "timeout" && (
            <button
              type="button"
              onClick={retry}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
            >
              重新加载
            </button>
          )}
        </div>
      </div>
    );
  }

  // 模型加载失败
  if (isError) {
    return (
      <div className="flex flex-1 flex-col min-h-0 items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-medium text-red-600 mb-2">向量化模型加载失败</h2>
          <p className="text-sm text-slate-600 mb-4">{error ?? "未知错误"}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            重试
          </button>
          <p className="mt-3 text-xs text-slate-500">若多次失败，请检查网络连接后刷新页面。</p>
        </div>
      </div>
    );
  }

  // 模型已就绪
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <section className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-4">
        <MultiFileUploadZone
          items={items}
          onAddFiles={addFiles}
          onRemoveItem={removeItem}
          onClearCompleted={clearCompleted}
          disabled={false}
        />
      </section>

      <main className="flex-1 overflow-y-auto p-4">
        <DocumentList refreshTrigger={refreshTrigger} embeddingReady={true} />
      </main>
    </div>
  );
}
