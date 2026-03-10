/**
 * Embedding 模型 Hook — 订阅单例加载状态
 * 提供 ready / loading / error 状态与进度，控制页面准入
 */

import { useState, useEffect, useRef } from "react";
import {
  initEmbedding,
  subscribeEmbedding,
  retryEmbedding,
  type EmbeddingState,
} from "../lib/embeddingClient.js";

const MIN_DISPLAY_MS = 800;

export function useEmbeddingModel() {
  const [state, setState] = useState<EmbeddingState>("loading");
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  const initTimeRef = useRef(Date.now());

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
        setTimeout(() => setShowContent(true), remaining);
      } else {
        setShowContent(false);
      }
    });
  }, []);

  const retry = () => {
    initTimeRef.current = Date.now();
    setShowContent(false);
    retryEmbedding();
  };

  return {
    state,
    progress,
    currentFile,
    error,
    isReady: state === "ready",
    isLoading: state === "loading",
    isError: state === "error",
    showContent: showContent && state === "ready",
    retry,
  };
}
