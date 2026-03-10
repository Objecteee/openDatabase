/**
 * Web Worker: 分块计算文件 MD5，不阻塞主线程
 * 使用 spark-md5 增量计算
 */

import SparkMD5 from "spark-md5";
import { CHUNK_SIZE } from "../constants/upload.js";

self.onmessage = (e: MessageEvent<{ file: File }>) => {
  const { file } = e.data;
  if (!file || !(file instanceof File)) {
    self.postMessage({ error: "Invalid file" });
    return;
  }
  if (file.size === 0) {
    const spark = new SparkMD5.ArrayBuffer();
    self.postMessage({ hash: spark.end(), done: true });
    return;
  }

  const spark = new SparkMD5.ArrayBuffer();
  const chunks = Math.ceil(file.size / CHUNK_SIZE);
  let currentChunk = 0;

  const loadNext = () => {
    const start = currentChunk * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result;
      if (buffer && buffer instanceof ArrayBuffer) {
        spark.append(buffer);
        currentChunk++;
        self.postMessage({
          progress: currentChunk / chunks,
          read: currentChunk,
          total: chunks,
        });
        if (currentChunk < chunks) {
          loadNext();
        } else {
          const hash = spark.end();
          self.postMessage({ hash, done: true });
        }
      }
    };
    reader.onerror = () => {
      self.postMessage({ error: "Failed to read file chunk" });
    };
    reader.readAsArrayBuffer(blob);
  };

  loadNext();
};
