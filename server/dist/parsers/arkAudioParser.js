/**
 * 豆包语音识别大模型 音频解析器（极速版）
 *
 * 将音频 Buffer 通过豆包语音极速版 API 转为带时间戳的 Markdown 文本，
 * 包含全文转写 + 分句时间戳 + 词级时间戳，供后续 RAG 切片与溯源使用。
 *
 * 极速版特点：一次请求直接返回结果，无需 submit/query 轮询。
 * 限制：音频时长 ≤ 2 小时，大小 ≤ 100MB，格式：mp3/wav/ogg。
 *
 * 环境变量：
 *   DOUBAO_ASR_APP_KEY    — 豆包语音 App ID（必填）
 *   DOUBAO_ASR_ACCESS_KEY — 豆包语音 Access Token（必填）
 */
import crypto from "crypto";
const DOUBAO_ASR_APP_KEY = process.env.DOUBAO_ASR_APP_KEY;
const DOUBAO_ASR_ACCESS_KEY = process.env.DOUBAO_ASR_ACCESS_KEY;
const FLASH_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const RESOURCE_ID = "volc.bigasr.auc_turbo";
/**
 * 将音频 Buffer 通过豆包语音极速版 API 识别为带时间戳的 Markdown。
 *
 * @param audioBuffer  音频文件的二进制内容
 * @param format       音频格式（mp3/wav/ogg，m4a 请传 mp3）
 */
export async function parseAudioWithDoubao(audioBuffer, format = "mp3") {
    if (!DOUBAO_ASR_APP_KEY || !DOUBAO_ASR_ACCESS_KEY) {
        throw new Error("DOUBAO_ASR_APP_KEY 或 DOUBAO_ASR_ACCESS_KEY 未配置，无法调用豆包语音识别 API");
    }
    const requestId = crypto.randomUUID();
    const base64Data = audioBuffer.toString("base64");
    console.log(`[arkAudioParser] 开始音频识别，大小: ${(audioBuffer.length / 1024).toFixed(1)} KB，格式: ${format}`);
    const response = await fetch(FLASH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Api-App-Key": DOUBAO_ASR_APP_KEY,
            "X-Api-Access-Key": DOUBAO_ASR_ACCESS_KEY,
            "X-Api-Resource-Id": RESOURCE_ID,
            "X-Api-Request-Id": requestId,
            "X-Api-Sequence": "-1",
        },
        body: JSON.stringify({
            user: { uid: DOUBAO_ASR_APP_KEY },
            audio: { data: base64Data, format },
            request: {
                model_name: "bigmodel",
                enable_itn: true,
                enable_punc: true,
                show_utterances: true,
            },
        }),
    });
    const statusCode = response.headers.get("X-Api-Status-Code");
    const message = response.headers.get("X-Api-Message");
    if (statusCode !== "20000000") {
        const text = await response.text().catch(() => "");
        throw new Error(`豆包语音识别 API 请求失败 (${statusCode}): ${message} ${text}`);
    }
    const result = await response.json();
    const asrResult = result.result;
    if (!asrResult) {
        throw new Error("豆包语音识别 API 返回结果为空");
    }
    const fullText = asrResult.text ?? "";
    const durationMs = result.audio_info?.duration ?? 0;
    const utterances = (asrResult.utterances ?? []).map((u) => ({
        start_time: u.start_time ?? 0,
        end_time: u.end_time ?? 0,
        text: u.text ?? "",
        words: u.words?.map((w) => ({
            text: w.text ?? "",
            start_time: w.start_time ?? 0,
            end_time: w.end_time ?? 0,
        })),
    }));
    console.log(`[arkAudioParser] 识别完成，时长: ${msToTimestamp(durationMs)}，共 ${utterances.length} 句，${fullText.length} 字`);
    return {
        markdown: buildAudioMarkdown(fullText, utterances, durationMs),
        fullText,
        utterances,
        durationMs,
    };
}
/**
 * 将识别结果转为 Markdown，保留时间戳信息供 RAG 溯源。
 * 格式：全文概览 → 时间戳分句（每句含 [HH:mm:ss] 前缀）
 */
function buildAudioMarkdown(fullText, utterances, durationMs) {
    const lines = [];
    lines.push("# 音频转写内容");
    lines.push("");
    if (durationMs > 0) {
        lines.push(`**时长**：${msToTimestamp(durationMs)}`);
        lines.push("");
    }
    lines.push("## 全文转写");
    lines.push("");
    lines.push(fullText || "(无识别内容)");
    lines.push("");
    if (utterances.length > 0) {
        lines.push("## 时间戳分句");
        lines.push("");
        lines.push("每句格式：`[开始时间 ~ 结束时间]` 内容");
        lines.push("");
        for (const u of utterances) {
            const start = msToTimestamp(u.start_time);
            const end = msToTimestamp(u.end_time);
            lines.push(`**[${start} ~ ${end}]** ${u.text}`);
            lines.push("");
        }
    }
    return lines.join("\n");
}
/** 将毫秒转为 HH:mm:ss 格式（RAG 溯源 pointer 标准格式） */
export function msToTimestamp(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
/**
 * 根据文件扩展名推断音频格式参数
 */
export function getAudioFormat(ext) {
    const map = {
        mp3: "mp3",
        wav: "wav",
        ogg: "ogg",
        m4a: "mp3",
        aac: "mp3",
    };
    return map[ext.toLowerCase()] ?? "mp3";
}
