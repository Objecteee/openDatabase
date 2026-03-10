/**
 * 文件上传区域：拖拽/选择 → Web Worker MD5 → 秒传或分片上传
 */

import { useRef, useState } from "react";
import type { UploadState } from "../hooks/useFileUpload";

interface UploadZoneProps {
  state: UploadState;
  onUpload: (file: File) => void;
  onReset: () => void;
  disabled?: boolean;
}

export function UploadZone({ state, onUpload, onReset, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length || disabled) return;
    const file = files[0];
    if (!file) return;
    onUpload(file);
  };

  const phaseText: Record<string, string> = {
    idle: "选择或拖拽文件上传",
    hashing: "正在计算文件指纹…",
    checking: "正在检查秒传…",
    uploading: "正在上传…",
    done: "上传完成",
    error: "上传失败",
  };

  const progress = state.phase === "hashing" ? (state.hashProgress ?? 0) * 100 : state.progress * 100;

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-6 transition-colors ${
        isDragging && !disabled ? "border-indigo-500 bg-indigo-50/50" : "border-slate-300 bg-slate-50/50 hover:border-indigo-400"
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
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <div
        className="cursor-pointer text-center"
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <p className="text-slate-600">{phaseText[state.phase] || state.phase}</p>
        {(state.phase === "hashing" || state.phase === "uploading") && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {state.phase === "done" && state.documentId && (
          <p className="mt-2 text-sm text-green-600">文档 ID: {state.documentId}</p>
        )}
        {state.phase === "error" && state.error && (
          <p className="mt-2 text-sm text-red-600">{state.error}</p>
        )}
      </div>
      {(state.phase === "done" || state.phase === "error") && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            className="text-sm text-indigo-600 hover:underline"
          >
            继续上传
          </button>
        </div>
      )}
    </div>
  );
}
