-- 为 chunks 表增加引用溯源字段
-- pointer: 精确定位指针，PDF 用页码（如 "p.3"），视频/音频用时间戳（如 "00:01:23"），其他类型为 null
-- document_name: 冗余存储文档名，避免 citations 事件时再 JOIN documents 表
-- 运行：在 Supabase SQL Editor 中执行

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS pointer text;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS document_name text;
