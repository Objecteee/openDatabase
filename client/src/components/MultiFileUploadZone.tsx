/**
 * 多文件上传区域：拖拽/选择，队列展示
 */

import { useRef, useState } from "react";
import type { UploadItem } from "../hooks/useMultiFileUpload.js";
import { useTranslation } from "react-i18next";
import styles from "./MultiFileUploadZone.module.scss";

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
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (disabled || !files?.length) return;
    onAddFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const hasCompleted = items.some((it) => it.phase === "done" || it.phase === "error");

  return (
    <div className={styles.wrap}>
      <div
        className={[
          styles.drop,
          disabled ? styles.dropDisabled : "",
          isDragging ? styles.dropActive : "",
        ].join(" ")}
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
          className={styles.hiddenInput}
          multiple
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div
          className={[
            styles.dropText,
            disabled ? styles.dropTextDisabled : "",
          ].join(" ")}
          onClick={() => !disabled && inputRef.current?.click()}
        >
          {disabled ? t("documents.model.initializing") : "选择或拖拽文件上传（支持多选）"}
        </div>
      </div>

      {items.length > 0 && (
        <div>
          <div className={styles.queueHeader}>
            <span>上传队列</span>
            {hasCompleted && (
              <button
                type="button"
                onClick={onClearCompleted}
                className={styles.linkBtn}
              >
                清除已完成
              </button>
            )}
          </div>
          <ul className={styles.queue}>
            {items.map((it) => (
              <li
                key={it.id}
                className={styles.item}
              >
                <span className={styles.name} title={it.file.name}>
                  {it.file.name}
                </span>
                <span className={styles.size}>{formatSize(it.file.size)}</span>
                <span
                  className={[
                    styles.phase,
                    it.phase === "done" ? styles.phaseOk : "",
                    it.phase === "error" ? styles.phaseErr : "",
                  ].join(" ")}
                >
                  {phaseText[it.phase] || it.phase}
                  {it.phase === "error" && it.error ? `: ${it.error}` : ""}
                </span>
                {(it.phase === "hashing" || it.phase === "uploading") && (
                  <div className={styles.miniBar}>
                    <div
                      className={styles.miniBarFill}
                      style={{
                        width: `${(it.phase === "hashing" ? (it.hashProgress ?? 0) : it.progress) * 100}%`,
                      }}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveItem(it.id)}
                  className={styles.remove}
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
