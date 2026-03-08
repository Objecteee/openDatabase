# API 测试目录

本目录用于 302.ai API 接口联调与验证。

## 环境配置

1. 复制 `.env.example` 为 `.env`
2. 在 `.env` 中填入 `AI_API_KEY`（或使用示例中的临时密钥）
3. 运行 `npm install` 安装依赖

## 运行测试

```bash
# Chat 对话 API 测试
npm run test:chat

# 视频理解 API 测试（异步提交 + 轮询结果）
npm run test:video

# WhisperX 语音转文字测试（带时间戳）
npm run test:whisperx

# MinerU PDF 解析 API 测试（创建任务）
npm run test:pdf
```

**WhisperX 说明**：必须传入音频 base64 编码。
```bash
node whisperx.test.js <base64字符串>
# 或
AUDIO_BASE64=<base64> node whisperx.test.js
# 支持 data URI：data:audio/wav;base64,UklGRi...
```

## 安全说明

- `.env` 已加入 `.gitignore`，切勿提交包含真实 API Key 的文件
- 生产环境请使用环境变量或密钥管理服务
