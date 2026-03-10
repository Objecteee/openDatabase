/**
 * 文档库页：上传 + 列表
 * Embedding 模型在 Web Worker 中单例加载，初始化完成前禁止上传
 * 模型加载完成后内容才展示，进度条最少展示 800ms 避免闪灭
 */

import { useState } from "react";
import { useEmbeddingModel } from "../hooks/useEmbeddingModel.js";
import { useMultiFileUpload } from "../hooks/useMultiFileUpload.js";
import { MultiFileUploadZone } from "../components/MultiFileUploadZone.js";
import { DocumentList } from "../components/DocumentList.js";

export function DocumentsPage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { isReady, isError, progress, currentFile, error, showContent } = useEmbeddingModel();
  const { items, addFiles, removeItem, clearCompleted } = useMultiFileUpload(() => {
    setRefreshTrigger((t) => t + 1);
  });

  return (
    <div className="flex flex-1 flex-col min-h-0 relative">
      {!showContent && !isError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
          <p className="text-slate-600 mb-4">
            {isReady ? "准备就绪…" : "正在加载向量化模型…"}
          </p>
          <div className="w-64 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${(isReady ? 1 : progress) * 100}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {isReady ? "即将进入" : currentFile ? `正在加载 ${currentFile}…` : "首次加载约需下载 100MB，已缓存供后续使用"}
          </p>
        </div>
      )}
      {isError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
          <p className="text-red-600 mb-2">模型加载失败</p>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      )}
      {showContent && (
        <>
          <section className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-4">
            <MultiFileUploadZone
              items={items}
              onAddFiles={addFiles}
              onRemoveItem={removeItem}
              onClearCompleted={clearCompleted}
              disabled={!isReady}
            />
          </section>

          <main className="flex-1 overflow-y-auto p-4">
            <DocumentList refreshTrigger={refreshTrigger} />
          </main>
        </>
      )}
    </div>
  );
}
