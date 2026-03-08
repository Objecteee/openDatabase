1. 核心智能体角色定义 (Core Roles)
1.1 架构总师 (The Architect)
核心职责：维护 .spec/ 目录下的所有规格文档，确保数据结构（Supabase）与接口契约（API Contract）的一致性。

技术准则：

强制执行单例模式 (Singleton) 加载模型。

负责定义 pgvector 的维度以及全模态元数据（Metadata）的 JSONB 结构。

1.2 性能与并发专家 (Performance Specialist)
核心职责：实现 Web Worker 调度、大文件分片上传及 SSE 渲染优化。

技术准则：

任何阻塞主线程超过 50ms 的计算任务必须移至 Worker。

确保双 Token 刷新机制中的“请求锁队列”逻辑无死锁。

1.3 UI/UX 适配专家 (Responsive Specialist)
核心职责：负责 rem2px 方案的工程落地及多端交互实现。

技术准则：

开发时严格遵循 750px 基准稿，确保所有 UI 在移动端和桌面端等比例缩放。

负责引用溯源 (Citation) 的交互反馈：点击标签精准跳转预览位。

2. Superpowers 技能调用协议 (Skill Protocols)
在执行任何非琐碎任务前，Cursor 必须按以下顺序调用技能：

第一步：需求澄清 (Brainstorming)
调用技能：skill-brainstorming。

动作：AI 必须列出至少 3 个实现方案（例如：视频解析是选 Gemini API 还是前端关键帧提取？），并分析性能、成本与隐私影响。

第二步：计划编写 (Writing Plans)
调用技能：skill-writing-plans。

动作：在 TODO.md 中生成详细的步骤清单。每一项必须包含“预期结果”和“自检标准”。

第三步：系统化执行与调试 (Execution & Debugging)
调用技能：skill-executing-plans, skill-systematic-debugging。

动作：严格按计划编码。遇到逻辑错误时，必须先通过 skill-root-cause-tracing 追踪变量流向，严禁基于猜想修改代码。

第四步：闭环验证 (Verification)
调用技能：skill-verification-before-completion。

动作：提交代码前检查：

是否包含绝对像素 (px)？

Web Worker 通信是否处理了异常？

国际化词条是否已同步到英/日语言包？

3. 全模态 RAG 实现规格 (Implementation Specs)
3.1 资产处理管线 (Asset Pipeline)
文件校验：前端计算 MD5 指纹（Hash Worker） -> 请求秒传接口。

多模态解析：根据文件类型分配处理器：

视频：提取时间戳 + 场景描述。

PDF：按页码切片 + 提取表格内容。

向量化：调用单例模型生成 Embedding -> 存入 Supabase pgvector。

3.2 引用溯源交互 (The Citation Flow)
数据结构：所有检索到的 Chunk 必须携带 source_pointer: { page?: number, timestamp?: string, type: string }。

回答生成：AI 在输出时自动在相关文本后附加 [^id] 引用标签。

4. 目录结构指南 (Directory Context)
Cursor 在开发时应优先参考以下结构：

Plaintext
/
├── .cursor                  # 核心约束
├── Agents.md                # 角色与技能逻辑 (本文件)
├── TODO.md                  # 实时任务追踪
├── .spec/                   # 技术规格库
│   ├── SPEC_UI_UX.md        # UI/UX 交互规范
│   ├── SPEC_DATABASE.md     # 数据库 Schema 与 RLS
│   └── SPEC_API.md          # 接口契约与 SSE 协议
├── .claude/skills/          # Superpowers 技能目录
└── src/
    ├── workers/             # 存放所有的 Web Workers
    ├── hooks/               # 包含无感刷新等逻辑
    └── services/            # 模型加载单例与 API 封装



# 项目说明

这是一个 **文档 RAG + 语音 AI 问答系统**。

用户可以上传文档，然后基于文档内容提问，并支持语音输入和语音回答。

技术栈：

Node.js
Express
TypeScript

AI API 使用 **OpenAI 兼容接口**。

环境变量：

AI_API_KEY
AI_BASE_URL

示例：

AI_BASE_URL=https://api.302.ai/v1

------

# 核心功能

系统必须实现以下功能：

1 文档上传

支持：

PDF
TXT
Markdown

服务器需要：

解析文档
提取文本

------

2 文本切分

将文本分割为多个 chunk。

要求：

chunk ≈ 500 tokens
overlap ≈ 100 tokens

------

3 Embedding

为每个 chunk 生成 embedding。

------

4 向量数据库

实现一个简单 vector store。

存储：

text
embedding
metadata

------

5 RAG 问答

流程：

用户提问
↓
生成问题 embedding
↓
向量搜索
↓
返回最相关的 5 个 chunk
↓
构建 prompt
↓
发送给 LLM
↓
返回回答

------

6 语音功能

必须支持：

Speech to Text
Text to Speech

------

# API 设计

POST /upload

上传文档

POST /chat

文档问答

POST /speech-to-text

语音转文字

POST /text-to-speech

文字转语音

------

# 项目结构

server/

routes/

upload.ts
chat.ts
speech.ts

services/

aiProvider.ts
ragService.ts
vectorStore.ts
speechService.ts

utils/

textSplitter.ts
embedding.ts