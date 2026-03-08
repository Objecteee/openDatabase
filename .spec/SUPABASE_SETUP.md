# Supabase 建表步骤

> 从零开始，在 Supabase 中创建项目所需数据库表。

---

## 一、注册与创建项目

1. 打开 [https://supabase.com](https://supabase.com)，点击 **Start your project**
2. 使用 GitHub / Google 登录，或注册账号
3. 登录后点击 **New Project**
4. 填写：
   - **Name**：项目名（如 `my-rag-app`）
   - **Database Password**：设置并牢记数据库密码（后续连接需要）
   - **Region**：选择离你近的区域（如 `Northeast Asia (Tokyo)`）
5. 点击 **Create new project**，等待约 1 分钟创建完成

---

## 二、打开 SQL 编辑器

1. 左侧菜单点击 **SQL Editor**
2. 点击 **New query** 新建一个查询窗口

---

## 三、启用 pgvector 扩展

在 SQL 编辑器中粘贴并执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

点击右下角 **Run** 或按 `Ctrl+Enter` 执行。执行成功会提示 `Success`。

---

## 四、创建表（按顺序执行）

### 1. 创建 documents 表

```sql
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  type text NOT NULL,
  size bigint NOT NULL,
  hash text NOT NULL,
  storage_path text NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 2. 创建 chunks 表

```sql
CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb,
  chunk_index int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 3. 创建 conversations 表

```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 4. 创建 messages 表

```sql
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 5. 创建 conversation_documents 表

```sql
CREATE TABLE conversation_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 五、执行方式

- **方式一**：一次复制一个 `CREATE TABLE` 块，粘贴到编辑器，点击 **Run**
- **方式二**：把全部 SQL 粘贴进去，一次性执行（若有报错会停在第一处错误）

---

## 六、验证表是否创建成功

1. 左侧菜单点击 **Table Editor**
2. 应能看到：`documents`、`chunks`、`conversations`、`messages`、`conversation_documents` 五张表

---

## 七、获取连接信息（后端用）

1. 左侧菜单点击 **Project Settings**（齿轮）
2. 点击 **Database**
3. 在 **Connection string** 区域：
   - **URI**：完整连接串（含密码）
   - **Host**、**Port**、**Database**、**User**、**Password**：各项单独值

示例：

```
Host: db.xxxxxxxxxxxx.supabase.co
Port: 5432
Database: postgres
User: postgres
Password: (你在创建项目时设的密码)
```

---

## 八、创建 Storage 桶（存文件用）

1. 左侧菜单点击 **Storage**
2. 点击 **New bucket**
3. 填写：
   - **Name**：`documents`（或 `assets`）
   - **Public bucket**：关闭（选 **Private**，需鉴权访问）
4. 点击 **Create bucket**

---

## 九、常见问题

| 问题 | 处理 |
|------|------|
| `vector` 类型不存在 | 先执行 `CREATE EXTENSION vector;` |
| 外键报错 | 确保先创建 `documents`、`conversations`，再建依赖它们的表 |
| 密码遗忘 | Project Settings → Database → Reset database password |

---

## 十、一键执行全部建表 + 向量函数（可选）

可将以下整段 SQL 复制到 SQL Editor，一次性执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  type text NOT NULL,
  size bigint NOT NULL,
  hash text NOT NULL,
  storage_path text NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb,
  chunk_index int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 向量检索函数（RAG 用）
CREATE OR REPLACE FUNCTION match_chunks(query_embedding vector(1536), match_count int DEFAULT 5)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata
  FROM chunks c
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```
