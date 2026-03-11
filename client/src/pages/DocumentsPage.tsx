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
import { useTranslation } from "react-i18next";
import styles from "./DocumentsPage.module.scss";

const INITIALIZING_DELAY_MS = 2000;
const TIMEOUT_MS = 60_000;
const PHASE_CHECK_INTERVAL_MS = 1000;

type LoadPhase = "downloading" | "initializing" | "timeout";

export function DocumentsPage() {
  const { t } = useTranslation();
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
        ? t("documents.model.timeout")
        : phase === "initializing"
          ? t("documents.model.initializing")
          : currentFile || t("documents.model.firstDownload");

    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <h2 className={styles.title}>{t("documents.model.title")}</h2>
          <p className={styles.desc}>{statusText}</p>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className={styles.meta}>
            <span>{phase === "timeout" ? "Timeout" : `${Math.round(progress * 100)}%`}</span>
            <span>{phase}</span>
          </div>
          {phase === "timeout" && (
            <button type="button" onClick={retry} className={styles.retryBtn}>
              {t("documents.model.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // 模型加载失败
  if (isError) {
    return (
      <div className={styles.center}>
        <div className={styles.panel} style={{ textAlign: "center" }}>
          <h2 className={`${styles.title} ${styles.dangerTitle}`}>{t("documents.model.failedTitle")}</h2>
          <p className={styles.desc}>{error ?? t("documents.model.unknownError")}</p>
          <button type="button" onClick={retry} className={styles.retryBtn}>
            {t("documents.model.retry")}
          </button>
          <p className={styles.meta} style={{ justifyContent: "center" }}>
            {t("documents.model.failedHint")}
          </p>
        </div>
      </div>
    );
  }

  // 模型已就绪
  return (
    <div className={styles.page}>
      <section className={styles.top}>
        <MultiFileUploadZone
          items={items}
          onAddFiles={addFiles}
          onRemoveItem={removeItem}
          onClearCompleted={clearCompleted}
          disabled={false}
        />
      </section>

      <main className={styles.main}>
        <DocumentList refreshTrigger={refreshTrigger} embeddingReady={true} />
      </main>
    </div>
  );
}
