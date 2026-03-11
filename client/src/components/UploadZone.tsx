/**
 * 文件上传区域：拖拽/选择 → Web Worker MD5 → 秒传或分片上传
 */

import { useRef, useState } from "react";
import type { UploadState } from "../hooks/useFileUpload";
import styles from "./UploadZone.module.scss";

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
      className={`${styles.drop} ${isDragging && !disabled ? styles.dropActive : ""}`}
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
        className={styles.hiddenInput}
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <div
        className={styles.clickArea}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <p className={styles.text}>{phaseText[state.phase] || state.phase}</p>
        {(state.phase === "hashing" || state.phase === "uploading") && (
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {state.phase === "done" && state.documentId && (
          <p className={styles.ok}>文档 ID: {state.documentId}</p>
        )}
        {state.phase === "error" && state.error && (
          <p className={styles.err}>{state.error}</p>
        )}
      </div>
      {(state.phase === "done" || state.phase === "error") && (
        <div className={styles.footer}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            className={styles.linkBtn}
          >
            继续上传
          </button>
        </div>
      )}
    </div>
  );
}
