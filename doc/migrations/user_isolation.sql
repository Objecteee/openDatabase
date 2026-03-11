-- 多租户 / 用户隔离：为核心表增加 user_id 并回填
-- 运行：在 Supabase SQL Editor 中执行

-- 1) chunks 增加 user_id（从 documents.user_id 回填）
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE chunks c
SET user_id = d.user_id
FROM documents d
WHERE c.user_id IS NULL AND c.document_id = d.id;
CREATE INDEX IF NOT EXISTS chunks_user_id_idx ON chunks (user_id);

-- 2) messages 增加 user_id（从 conversations.user_id 回填）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE messages m
SET user_id = c.user_id
FROM conversations c
WHERE m.user_id IS NULL AND m.conversation_id = c.id;
CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages (user_id);

-- 3) conversation_documents 增加 user_id（从 conversations.user_id 回填）
ALTER TABLE conversation_documents ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE conversation_documents cd
SET user_id = c.user_id
FROM conversations c
WHERE cd.user_id IS NULL AND cd.conversation_id = c.id;
CREATE INDEX IF NOT EXISTS conversation_documents_user_id_idx ON conversation_documents (user_id);

-- 4) 新 RPC：按 user_id 限定的向量检索（推荐后端使用）
DROP FUNCTION IF EXISTS match_chunks_scoped(vector(384), uuid, integer);
CREATE FUNCTION match_chunks_scoped(
  query_embedding vector(384),
  scope_user_id uuid,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb, chunk_group_id uuid)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT c.id AS cid,
           c.document_id AS cdocument_id,
           c.content AS ccontent,
           c.metadata AS cmetadata,
           c.chunk_group_id AS cchunk_group_id,
           (c.embedding <=> query_embedding) AS dist
    FROM chunks c
    WHERE c.vector_type = 'enriched_main'
      AND c.user_id = scope_user_id
  ),
  best_per_group AS (
    SELECT DISTINCT ON (COALESCE(s.cchunk_group_id::text, s.cid::text))
      s.cid, s.cdocument_id, s.ccontent, s.cmetadata, s.cchunk_group_id, s.dist
    FROM scored s
    ORDER BY COALESCE(s.cchunk_group_id::text, s.cid::text), s.dist
  )
  SELECT b.cid, b.cdocument_id, b.ccontent, b.cmetadata, b.cchunk_group_id
  FROM best_per_group b
  ORDER BY b.dist
  LIMIT match_count;
END;
$$;

-- 5) 新 RPC：按 user_id + document_ids 限定的向量检索
DROP FUNCTION IF EXISTS match_chunks_filtered_scoped(vector(384), uuid, uuid[], integer);
CREATE FUNCTION match_chunks_filtered_scoped(
  query_embedding vector(384),
  scope_user_id uuid,
  filter_document_ids uuid[] DEFAULT NULL,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb, chunk_group_id uuid)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT c.id AS cid,
           c.document_id AS cdocument_id,
           c.content AS ccontent,
           c.metadata AS cmetadata,
           c.chunk_group_id AS cchunk_group_id,
           (c.embedding <=> query_embedding) AS dist
    FROM chunks c
    WHERE c.vector_type = 'enriched_main'
      AND c.user_id = scope_user_id
      AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  ),
  best_per_group AS (
    SELECT DISTINCT ON (COALESCE(f.cchunk_group_id::text, f.cid::text))
      f.cid, f.cdocument_id, f.ccontent, f.cmetadata, f.cchunk_group_id, f.dist
    FROM filtered f
    ORDER BY COALESCE(f.cchunk_group_id::text, f.cid::text), f.dist
  )
  SELECT b.cid, b.cdocument_id, b.ccontent, b.cmetadata, b.cchunk_group_id
  FROM best_per_group b
  ORDER BY b.dist
  LIMIT match_count;
END;
$$;

