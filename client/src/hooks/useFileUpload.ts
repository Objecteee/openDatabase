/**
 * 单文件上传 Hook（内部使用 uploadCore）
 */

import { useState, useCallback } from "react";
import { performUpload, type UploadProgress } from "../lib/uploadCore.js";

export type UploadPhase = "idle" | "hashing" | "checking" | "uploading" | "done" | "error";

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  hashProgress?: number;
  error?: string;
  documentId?: string;
}

export function useFileUpload() {
  const [state, setState] = useState<UploadState>({ phase: "idle", progress: 0 });

  const upload = useCallback(async (file: File) => {
    setState({ phase: "hashing", progress: 0, hashProgress: 0 });

    try {
      const result = await performUpload(file, (p: UploadProgress) => {
        setState((s) => ({
          ...s,
          phase: p.phase,
          progress: p.progress,
          hashProgress: p.hashProgress,
        }));
      });

      if (result.documentId) {
        setState({ phase: "done", progress: 1, documentId: result.documentId });
      } else {
        setState({ phase: "error", progress: 0, error: result.error || "上传失败" });
      }
    } catch (e) {
      setState({ phase: "error", progress: 0, error: e instanceof Error ? e.message : "上传失败" });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ phase: "idle", progress: 0 });
  }, []);

  return { state, upload, reset };
}
