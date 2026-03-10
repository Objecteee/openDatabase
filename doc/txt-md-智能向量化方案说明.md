# txt/md 智能向量化方案说明

> 阶段 A 智能切片 + 阶段 B 语义增强 + 阶段 C 单 ID 多向量  
> 更新日期：2025-03-10

---

## 一、流程概览

```
原始文本 (txt/md)
    │
    ├─ 阶段 A：智能切片 (Smart Chunking)
    │      DeepSeek 在语义转折、话题切换处插入 [SPLIT]
    │      约束：不切断 Markdown 表格/代码块，单段 500-800 字
    │
    ├─ 阶段 B：语义增强 (Semantic Enrichment)
    │      每个切片 → DeepSeek 提取 Summary、Keywords、2 个 HyDE 问题
    │
    └─ 阶段 C：高维度向量化
           ├─ 增强型主向量： [ID: xx] [Type: txt] [Summary: ...] [Keywords: ...] [Content: ...]
           ├─ 模拟提问向量 1： hypothetical_question_1
           └─ 模拟提问向量 2： hypothetical_question_2
                   │
                   └→ 3 条 chunks 记录，chunk_group_id 相同，指向同一 content
```

---

## 二、实现文件

| 模块 | 路径 |
|------|------|
| DeepSeek 调用 | `server/src/services/deepseekService.ts` |
| 阶段 A 智能切片 | `server/src/parsers/smartChunkingParser.ts` |
| 阶段 B 语义增强 | `server/src/services/semanticEnrichmentService.ts` |
| 解析服务 | `server/src/services/parseService.ts` |
| Chunk 写入 | `server/src/services/chunkService.ts` (insertMultiVectorChunks) |
| 前端向量化 | `client/src/lib/vectorizeService.ts` |
| 数据库迁移 | `doc/migrations/chunks_add_vector_type.sql` |

---

## 三、环境配置

在 `server/.env` 中增加：

```
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

---

## 四、数据库迁移

在 Supabase SQL Editor 中执行 `doc/migrations/chunks_add_vector_type.sql`：

1. 为 chunks 表新增 `chunk_group_id`、`vector_type`
2. 已有数据：`chunk_group_id = id`，`vector_type = enriched_main`
3. 更新 `match_chunks`：按 chunk_group_id 去重，返回每组合并结果

---

## 五、Prompt 设计要点

### 5.1 智能切片 (Stage A)

- **任务**：在语义转折、话题切换处插入 [SPLIT]
- **约束**：保持原文；不切断表格、代码块；单段 500-800 字
- **输出**：直接返回带 [SPLIT] 的全文，无解释

### 5.2 语义增强 (Stage B)

- **输出 JSON**：`{ summary, keywords, hypothetical_questions }`
- **summary**：20-50 字核心概括
- **keywords**：3-5 个技术/主题词
- **hypothetical_questions**：2 个用户可能问的 HyDE 问题，与片段强相关

---

## 六、存储结构

| chunk_group_id | vector_type   | content         | 说明           |
|----------------|---------------|-----------------|----------------|
| uuid-001       | enriched_main | 原始 MD 片段    | 增强型主向量   |
| uuid-001       | qa_hypothetical | 同上          | 模拟提问 1 向量 |
| uuid-001       | qa_hypothetical | 同上          | 模拟提问 2 向量 |

检索时：搜索所有向量，按 `chunk_group_id` 去重，取每组相似度最高的一条。

---

## 七、使用方式

1. 上传 txt 或 md 文件
2. 点击「向量化」
3. 后端：下载 → 智能切片 (DeepSeek) → 语义增强 (DeepSeek) → 返回 chunks
4. 前端：构造 enriched + 2 HyDE 文本 → embedBatch → POST chunks
5. 后端：insertMultiVectorChunks 写入 3N 条记录
