/**
 * 火山引擎 豆包语音识别大模型 测试（录音文件极速版 + 时间戳）
 * 文档：https://www.volcengine.com/docs/6561/1631584
 *
 * 极速版特点：一次请求即返回结果，无需轮询（标准版需要 submit/query 两步）
 * 支持：URL 传入 或 base64 直传（本地文件）
 *
 * 凭证获取：
 *   登录 https://console.volcengine.com/speech/service/16
 *   开通「语音识别大模型」→ 获取 App ID 和 Access Token
 *
 * 环境变量（test/.env）：
 *   DOUBAO_ASR_APP_KEY    — 豆包语音 App ID（必填）
 *   DOUBAO_ASR_ACCESS_KEY — 豆包语音 Access Token（必填）
 *
 * 运行：node test/ark-audio-asr.test.js
 * 指定本地文件：AUDIO_FILE=/path/to/audio.mp3 node test/ark-audio-asr.test.js
 * 指定远程 URL：AUDIO_URL=https://xxx.mp3 node test/ark-audio-asr.test.js
 */

import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOUBAO_ASR_APP_KEY = process.env.DOUBAO_ASR_APP_KEY;
const DOUBAO_ASR_ACCESS_KEY = process.env.DOUBAO_ASR_ACCESS_KEY;

/** 极速版接口：一次请求直接返回结果 */
const FLASH_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const RESOURCE_ID = "volc.bigasr.auc_turbo";

if (!DOUBAO_ASR_APP_KEY || !DOUBAO_ASR_ACCESS_KEY) {
  console.error("❌ 缺少豆包语音凭证，请在 test/.env 中配置：");
  console.error("   DOUBAO_ASR_APP_KEY=<App ID>");
  console.error("   DOUBAO_ASR_ACCESS_KEY=<Access Token>");
  console.error("");
  console.error("凭证获取地址：https://console.volcengine.com/speech/service/16");
  process.exit(1);
}

/**
 * 调用极速版接口识别音频（支持 URL 或 base64）
 * @param {{ url?: string; data?: string; format?: string }} audio
 */
async function recognizeFlash(audio) {
  const requestId = crypto.randomUUID();

  const body = {
    user: { uid: DOUBAO_ASR_APP_KEY },
    audio,
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      show_utterances: true,
    },
  };

  const res = await fetch(FLASH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-App-Key": DOUBAO_ASR_APP_KEY,
      "X-Api-Access-Key": DOUBAO_ASR_ACCESS_KEY,
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify(body),
  });

  const statusCode = res.headers.get("X-Api-Status-Code");
  const message = res.headers.get("X-Api-Message");

  if (statusCode !== "20000000") {
    const text = await res.text().catch(() => "");
    throw new Error(`识别失败 (${statusCode}): ${message} ${text}`);
  }

  return res.json();
}

/** 将毫秒转为 HH:mm:ss.mmm 格式 */
function msToTimestamp(ms) {
  const totalSec = Math.floor(ms / 1000);
  const msRemainder = ms % 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(msRemainder).padStart(3, "0")}`;
}

async function run() {
  console.log("火山引擎 豆包语音识别大模型 测试（极速版 + 时间戳）");
  console.log("服务: 大模型录音文件极速版 (volc.bigasr.auc_turbo)");
  console.log("文档: https://www.volcengine.com/docs/6561/1631584");
  console.log("");

  const localFile = process.env.AUDIO_FILE;
  const remoteUrl = process.env.AUDIO_URL;

  let audioParam;
  let audioDesc;

  if (localFile) {
    if (!fs.existsSync(localFile)) {
      console.error(`❌ 文件不存在: ${localFile}`);
      process.exit(1);
    }
    const stat = fs.statSync(localFile);
    const ext = localFile.split(".").pop()?.toLowerCase() ?? "mp3";
    const fileBuffer = fs.readFileSync(localFile);
    const base64Data = fileBuffer.toString("base64");
    audioParam = { data: base64Data, format: ext === "m4a" ? "mp3" : ext };
    audioDesc = `本地文件: ${localFile} (${(stat.size / 1024).toFixed(1)} KB)`;
  } else if (remoteUrl) {
    const ext = remoteUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "mp3";
    const formatMap = { mp3: "mp3", wav: "wav", m4a: "mp3", ogg: "ogg" };
    audioParam = { url: remoteUrl, format: formatMap[ext] ?? "mp3" };
    audioDesc = `远程 URL: ${remoteUrl}`;
  } else {
    // 生成一段简短的测试音频（静音 WAV，用于验证 API 连通性）
    // 实际测试请通过 AUDIO_FILE 或 AUDIO_URL 指定真实音频
    console.log("⚠️  未指定音频文件，将使用内置的 WAV 静音片段测试 API 连通性");
    console.log("   建议：AUDIO_FILE=/path/to/audio.mp3 node test/ark-audio-asr.test.js");
    console.log("   或：  AUDIO_URL=https://xxx.mp3 node test/ark-audio-asr.test.js");
    console.log("");

    // 生成最小合法 WAV（44 字节头 + 0 字节数据）
    const wavHeader = Buffer.alloc(44);
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(36, 4);
    wavHeader.write("WAVE", 8);
    wavHeader.write("fmt ", 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(16000, 24);
    wavHeader.writeUInt32LE(32000, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write("data", 36);
    wavHeader.writeUInt32LE(0, 40);
    audioParam = { data: wavHeader.toString("base64"), format: "wav" };
    audioDesc = "内置静音 WAV（仅测试连通性）";
  }

  console.log("--- 1. 测试音频 ---");
  console.log(audioDesc);
  console.log("");

  console.log("--- 2. 发起识别请求（极速版，无需轮询）---");
  const start = Date.now();
  let result;
  try {
    result = await recognizeFlash(audioParam);
  } catch (e) {
    console.error("\n❌ 识别失败:", e.message);
    process.exit(1);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ 识别完成，耗时 ${elapsed}s`);
  console.log("");

  console.log("--- 3. 识别结果 ---");
  const asrResult = result?.result;
  const audioInfo = result?.audio_info;

  if (!asrResult) {
    console.error("❌ 返回结果为空");
    console.log("原始响应:", JSON.stringify(result, null, 2).slice(0, 500));
    process.exit(1);
  }

  if (audioInfo?.duration) {
    console.log("音频时长:", msToTimestamp(audioInfo.duration));
  }
  console.log("全文字符数:", asrResult.text?.length ?? 0);
  console.log("");

  if (asrResult.text) {
    console.log("--- 4. 全文转写 ---");
    console.log(asrResult.text);
    console.log("");
  }

  const utterances = asrResult.utterances ?? [];
  if (utterances.length > 0) {
    console.log(`--- 5. 时间戳分句（共 ${utterances.length} 句，RAG 溯源精度：毫秒级）---`);
    utterances.forEach((u, i) => {
      const start = msToTimestamp(u.start_time ?? 0);
      const end = msToTimestamp(u.end_time ?? 0);
      console.log(`\n  [${i + 1}] ${start} ~ ${end}`);
      console.log(`      ${u.text ?? ""}`);
      if (u.words?.length) {
        const wordPreview = u.words
          .slice(0, 5)
          .map((w) => `${w.text}(${w.start_time}-${w.end_time}ms)`)
          .join(" ");
        console.log(`      词级: ${wordPreview}${u.words.length > 5 ? ` ...(共${u.words.length}词)` : ""}`);
      }
    });
    console.log("");

    const hasWordLevel = utterances.some((u) => u.words?.length > 0);
    console.log("--- 6. RAG 溯源能力评估 ---");
    console.log(`分句时间戳: ✅ (精度 ms，格式 HH:mm:ss.mmm)`);
    console.log(`词级时间戳: ${hasWordLevel ? "✅" : "❌（需开启 show_utterances=true）"}`);
    console.log("结论：可精确到句级时间戳，适合 RAG 溯源（pointer 精确到 hh:mm:ss）");
  } else {
    console.log("(无分句数据，可能是静音或极短音频)");
  }

  console.log("\n✅ 测试通过 - 豆包语音识别大模型极速版可正常使用");
  process.exit(0);
}

run().catch((e) => {
  console.error("\n❌ 测试失败:", e.message);
  process.exit(1);
});
