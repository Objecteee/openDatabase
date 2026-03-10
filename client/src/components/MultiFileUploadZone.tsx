/**
 * 多文件上传区域：拖拽/选择，队列展示
 */

import { useRef, useState } from "react";
import type { UploadItem } from "../hooks/useMultiFileUpload.js";

interface MultiFileUploadZoneProps {
  items: UploadItem[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveItem: (id: string) => void;
  onClearCompleted: () => void;
  disabled?: boolean;
}

const phaseText: Record<string, string> = {
  queued: "排队中",
  hashing: "计算指纹…",
  checking: "检查秒传…",
  uploading: "上传中…",
  done: "完成",
  error: "失败",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MultiFileUploadZone({
  items,
  onAddFiles,
  onRemoveItem,
  onClearCompleted,
  disabled = false,
}: MultiFileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (disabled || !files?.length) return;
    onAddFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const hasCompleted = items.some((it) => it.phase === "done" || it.phase === "error");

  return (
    <div className="space-y-3">
      <div
        className={`rounded-xl border-2 border-dashed p-6 transition-colors ${
          disabled
            ? "border-slate-200 bg-slate-100 cursor-not-allowed opacity-75"
            : isDragging
              ? "border-indigo-500 bg-indigo-50/50"
              : "border-slate-300 bg-slate-50/50 hover:border-indigo-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div
          className={`text-center text-slate-600 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          onClick={() => !disabled && inputRef.current?.click()}
        >
          {disabled ? "模型加载中，请稍候…" : "选择或拖拽文件上传（支持多选）"}
        </div>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>上传队列</span>
            {hasCompleted && (
              <button
                type="button"
                onClick={onClearCompleted}
                className="text-indigo-600 hover:underline"
              >
                清除已完成
              </button>
            )}
          </div>
          <ul className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-slate-200 bg-white p-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1 truncate text-slate-800" title={it.file.name}>
                  {it.file.name}
                </span>
                <span className="flex-shrink-0 text-slate-400">{formatSize(it.file.size)}</span>
                <span
                  className={`flex-shrink-0 text-xs ${
                    it.phase === "done" ? "text-green-600" : it.phase === "error" ? "text-red-600" : "text-slate-500"
                  }`}
                >
                  {phaseText[it.phase] || it.phase}
                  {it.phase === "error" && it.error ? `: ${it.error}` : ""}
                </span>
                {(it.phase === "hashing" || it.phase === "uploading") && (
                  <div className="w-16 h-1 flex-shrink-0 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{
                        width: `${(it.phase === "hashing" ? (it.hashProgress ?? 0) : it.progress) * 100}%`,
                      }}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveItem(it.id)}
                  className="flex-shrink-0 text-slate-400 hover:text-red-600"
                  title="移除"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
