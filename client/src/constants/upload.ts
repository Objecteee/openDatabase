/**
 * 上传相关常量（须与 server 保持一致）
 * @see server/src/routes/documents.ts
 */
export const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
export const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB 以下直传
export const MAX_CONCURRENT_CHUNKS = 6;
