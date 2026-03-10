/**
 * Embedding 模型 Hook：单例加载状态，进入文档页时自动初始化
 * 提供 ready、progress、error，用于控制上传区可用状态
 */

import { useState, useEffect, useRef } from "react";
import {
  initEmbedding,
  subscribeEmbedding,
  type EmbeddingState,
} from "../lib/embeddingClient.js";

const MIN_DISPLAY_MS = 800; // 进度条最少展示时长，避免闪灭

export function useEmbeddingModel() {
  const [state, setState] = useState<EmbeddingState>("loading");
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  const initTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    initTimeRef.current = Date.now();
    initEmbedding();
    return subscribeEmbedding((s, p, e, file) => {
      setState(s);
      setProgress(p);
      setCurrentFile(file ?? "");
      setError(e);
      if (s === "ready") {
        const elapsed = Date.now() - initTimeRef.current;
        const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
        setTimeout(() => {
          setShowContent(true);
        }, remaining);
      }
    });
  }, []);

  return {
    state,
    progress,
    currentFile,
    error,
    isReady: state === "ready",
    isLoading: state === "loading",
    isError: state === "error",
    showContent: showContent && state === "ready",
  };
}
