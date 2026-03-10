-- 单 ID 多向量：为 chunks 表增加 chunk_group_id、vector_type
-- 同一逻辑切片可有 3 条记录：1 enriched_main + 2 qa_hypothetical
-- 运行：在 Supabase SQL Editor 中执行

-- 1. 新增列（已有数据默认为单向量，chunk_group_id=id，vector_type=enriched_main）
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_group_id uuid;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS vector_type text DEFAULT 'enriched_main';

-- 2. 对已有数据：chunk_group_id 设为 id，vector_type 设为 enriched_main
UPDATE chunks SET chunk_group_id = id, vector_type = 'enriched_main' WHERE chunk_group_id IS NULL;

-- 3. 添加约束：vector_type 仅允许 enriched_main | qa_hypothetical
ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_vector_type_check;
ALTER TABLE chunks ADD CONSTRAINT chunks_vector_type_check
  CHECK (vector_type IN ('enriched_main', 'qa_hypothetical'));

-- 4. 修改 match_chunks：需先 DROP（返回类型变更不支持 REPLACE）
DROP FUNCTION IF EXISTS match_chunks(vector(384), integer);

-- 新建 match_chunks：按 chunk_group_id 去重，返回每组合并后的 content/metadata
CREATE FUNCTION match_chunks(query_embedding vector(384), match_count int DEFAULT 5)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb, chunk_group_id uuid)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT c.id, c.document_id, c.content, c.metadata, c.chunk_group_id,
           (c.embedding <=> query_embedding) AS dist
    FROM chunks c
  ),
  best_per_group AS (
    SELECT DISTINCT ON (COALESCE(chunk_group_id::text, id::text))
      id, document_id, content, metadata, chunk_group_id, dist
    FROM scored
    ORDER BY COALESCE(chunk_group_id::text, id::text), dist
  )
  SELECT b.id, b.document_id, b.content, b.metadata, b.chunk_group_id
  FROM best_per_group b
  ORDER BY b.dist
  LIMIT match_count;
END;
$$;

-- 可选：带 document_ids 过滤的版本
DROP FUNCTION IF EXISTS match_chunks_filtered(vector(384), uuid[], integer);

CREATE FUNCTION match_chunks_filtered(
  query_embedding vector(384),
  filter_document_ids uuid[] DEFAULT NULL,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb, chunk_group_id uuid)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT c.id, c.document_id, c.content, c.metadata, c.chunk_group_id,
           (c.embedding <=> query_embedding) AS dist
    FROM chunks c
    WHERE (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  ),
  best_per_group AS (
    SELECT DISTINCT ON (COALESCE(chunk_group_id::text, id::text))
      id, document_id, content, metadata, chunk_group_id, dist
    FROM filtered
    ORDER BY COALESCE(chunk_group_id::text, id::text), dist
  )
  SELECT b.id, b.document_id, b.content, b.metadata, b.chunk_group_id
  FROM best_per_group b
  ORDER BY b.dist
  LIMIT match_count;
END;
$$;
