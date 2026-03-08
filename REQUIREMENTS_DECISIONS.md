# 需求决策记录 (Requirements Decisions)

> 记录于 2025-03-08

## 1. 模态支持 (Modality)

- **首版范围**：支持全模态
- **文档**：PDF、TXT、Markdown、Word
- **媒体**：图片、视频、音频

## 2. 数据库 (Database)

- **状态**：暂时搁置，后期补全
- **选型**：暂定 Supabase + pgvector
- **当前**：表结构尚未建立

## 3. AI 接口 (API)

- **状态**：先一步任务为测试 API 接口
- **待确认**：302.ai 可用性、Chat/Embedding/Whisper/TTS 支持情况、备选方案

## 4. 测试 (Testing)

- **test/** 文件夹：用于 API 接口联调与验证
- **流程**：待用户提供 API 文档后，逐个跑通接口
