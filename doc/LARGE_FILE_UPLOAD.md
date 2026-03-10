# 大文件上传实现文档

> 本文档描述大文件上传的流程、接口规范、代码结构与规范约束。

---

## 一、整体流程

```
用户选择/拖拽文件
    ↓
Web Worker 分块计算 MD5（不阻塞主线程）
    ↓
POST /api/documents/check-upload { hash }
    ↓
┌─ 秒传命中 ────────────────────────→ 返回已有 document_id，结束
│
└─ 未命中
    ↓
    ├─ 文件 < 5MB ─→ POST /api/documents/upload (FormData) 直传
    │
    └─ 文件 ≥ 5MB ─→ 分片上传
                        ↓
                    POST /api/documents/upload/init
                        ↓
                    GET /api/documents/upload/status/:upload_id（断点续传用）
                        ↓
                    PUT /api/documents/upload/chunk/:upload_id/:index × N（并发 6）
                        ↓
                    POST /api/documents/upload/complete/:upload_id
```

---

## 二、规范与约束

### 2.1 规则要求（main.mdc）

| 规则 | 实现 |
|------|------|
| MD5 必须在 Web Worker 中计算 | `hash.worker.ts` 使用 spark-md5 分块计算 |
| 并发控制 Limit: 6 | `MAX_CONCURRENT_CHUNKS = 6` |
| 断点续传 | 支持 status 查询已传分片，仅上传缺失分片 |
| 大文件分片处理 | ≥ 5MB 启用分片，2MB/片 |

### 2.2 常量一致性

前后端共用常量，需保持一致：

| 常量 | 值 | 位置 |
|------|-----|------|
| `CHUNK_SIZE` | 2MB | `client/constants/upload.ts`、`server/constants/upload.ts` |
| `SMALL_FILE_THRESHOLD` | 5MB | 同上 |
| `MAX_CONCURRENT_CHUNKS` | 6 | `client/constants/upload.ts`（仅前端） |

---

## 三、API 规范

### 3.1 秒传检查

**POST** `/api/documents/check-upload`

请求体：
```json
{ "hash": "d41d8cd98f00b204e9800998ecf8427e" }
```

响应（命中）：
```json
{ "exists": true, "id": "uuid", "storage_path": "documents/xxx" }
```

响应（未命中）：
```json
{ "exists": false }
```

### 3.2 小文件直传

**POST** `/api/documents/upload`  
Content-Type: `multipart/form-data`

- `file`: 文件（必填，< 5MB）
- `hash`: MD5 字符串（可选）

成功响应：`{ "id": "uuid", "status": "pending" }`

### 3.3 分片上传

#### 3.3.1 初始化

**POST** `/api/documents/upload/init`

请求体：
```json
{ "name": "xxx.pdf", "size": 12345678, "hash": "..." }
```

响应：
```json
{ "upload_id": "uuid", "chunk_size": 2097152, "total_chunks": 6 }
```

#### 3.3.2 查询已传分片（断点续传）

**GET** `/api/documents/upload/status/:upload_id`

响应：`{ "received": [0, 1, 2], "total": 6 }`

#### 3.3.3 上传分片

**PUT** `/api/documents/upload/chunk/:upload_id/:chunk_index`  
Content-Type: `application/octet-stream`  
Body: 二进制分片数据

响应：`{ "ok": true, "received": 4, "total": 6 }`

#### 3.3.4 完成

**POST** `/api/documents/upload/complete/:upload_id`

请求体（可选）：`{ "name": "xxx.pdf", "type": "pdf" }`

响应：`{ "id": "uuid", "status": "pending" }`

---

## 四、安全与校验

| 项 | 处理 |
|----|------|
| `upload_id` 注入 | 服务端用 UUID 正则校验，防止路径穿越 |
| 空文件 | 前端拒绝 0 字节文件 |
| 分片越界 | 校验 `chunk_index < total_chunks` |
| 超时/错误清理 | `complete` 异常时清理临时分片与会话 |

---

## 五、文件结构

```
client/
├── src/
│   ├── constants/
│   │   └── upload.ts          # CHUNK_SIZE, SMALL_FILE_THRESHOLD, MAX_CONCURRENT_CHUNKS
│   ├── workers/
│   │   └── hash.worker.ts     # Web Worker MD5 计算
│   ├── hooks/
│   │   └── useFileUpload.ts   # 上传主逻辑
│   └── components/
│       └── UploadZone.tsx     # 上传 UI（拖拽、进度）
server/
├── src/
│   ├── constants/
│   │   └── upload.ts          # CHUNK_SIZE, SMALL_FILE_THRESHOLD
│   └── routes/
│       └── documents.ts       # 文档上传路由
```

---

## 六、实现要点

### 6.1 Web Worker 生命周期

- 计算完成后 `terminate()`
- 组件卸载时 `useEffect` 清理 `workerRef.current?.terminate()`

### 6.2 错误处理

- 秒传、初始化、直传、complete 均检查 `res.ok`
- 网络异常统一进入 `catch`，设置 `phase: "error"`

### 6.3 断点续传

1. `init` 后调用 `status` 获取已传分片
2. `toUpload = [0..N-1].filter(i => !received.has(i))`
3. 仅上传 `toUpload` 中的分片

### 6.4 临时文件清理

- `complete` 成功或失败后均执行 `cleanup()`：删除临时分片、移除会话

---

## 七、运行与测试

```bash
# 后端
cd server && npm run dev

# 前端
cd client && npm run dev
```

访问 http://localhost:5173，在顶部上传区域选择或拖拽文件。

**前置条件**：Supabase 已配置 `documents` bucket，`server/.env` 中设置 `SUPABASE_URL`、`SUPABASE_SERVICE_KEY`。
