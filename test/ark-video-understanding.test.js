/**
 * 火山引擎方舟 视频理解 API 测试（支持时间戳+文本）
 * 文档：https://www.volcengine.com/docs/82379/1895586
 *
 * 与 302.ai video-understanding 对比：
 * - 302.ai：异步提交+轮询，返回纯文本描述，无结构化时间戳
 * - 方舟：同步/流式，支持 prompt 指定 JSON 输出（start_time、end_time、event、danger）
 * - 方舟：基于「时间戳+图像」拼接，可感知视频时序，适合 RAG 溯源（pointer 精确到 hh:mm:ss）
 *
 * 运行：npm run test:ark-video 或 node ark-video-understanding.test.js
 *
 * 用法：
 *   1. 默认：使用文档示例视频 URL
 *   2. 指定 URL：ARK_VIDEO_URL=https://xxx.mp4 node ark-video-understanding.test.js
 */

import "dotenv/config";

const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const RESPONSES_URL = `${ARK_BASE_URL.replace(/\/$/, "")}/responses`;

/** 文档示例视频（公网可访问，<50MB） */
const DEFAULT_VIDEO_URL =
  process.env.ARK_VIDEO_URL ||
  "https://ark-project.tos-cn-beijing.volces.com/doc_video/ark_vlm_video_input.mp4";

/**
 * 知识库视频解析 prompt：全面提取视频信息，便于入库与 RAG 检索
 * 输出结构：summary（整体摘要）+ segments（按时间戳分段）+ entities（关键实体）
 */
const VIDEO_KB_PROMPT = `你是一个视频内容分析专家。请对视频进行**全面、结构化**的解析，提取所有可用于知识库检索的信息。输出必须为合法 JSON，不要包含 markdown 代码块或额外说明文字。

## 输出 JSON 结构（严格遵循）

{
  "summary": {
    "title": "视频主题/标题的简短概括",
    "overview": "100-200字整体描述，涵盖场景、主体、主要事件",
    "duration_seconds": 视频总时长秒数（数字）,
    "theme": ["主题1", "主题2"],
    "keywords": ["关键词1", "关键词2", "关键词3", "..."]
  },
  "segments": [
    {
      "start_time": "HH:mm:ss",
      "end_time": "HH:mm:ss",
      "content": "该时间段内的详细描述（场景、人物、物体、动作、文字、变化等）",
      "entities": ["本段出现的实体：人物/物体/地点等"],
      "events": ["本段发生的事件或动作"]
    }
  ],
  "entities": {
    "people": ["出现的人物/角色及其简要特征"],
    "objects": ["重要物体、道具、产品等"],
    "locations": ["场景、地点、环境描述"],
    "text_on_screen": ["画面中出现的文字、字幕、标识"]
  }
}

## 提取要求

1. **segments**：按时间顺序分段，每段 5-30 秒为宜；若视频很短可整段描述。必须覆盖视频全部时长。
2. **content**：每段需详细描述画面中的一切可见信息——人物、物体、场景、动作、文字、颜色、布局、变化等，不限于人物。
3. **entities**：汇总全片出现的核心实体，便于后续检索与关联。
4. **时间戳**：一律使用 HH:mm:ss 格式（如 00:00:05、00:01:23）。
5. 若某字段无内容，使用空数组 [] 或空字符串 ""，不要省略字段。`;

if (!ARK_API_KEY) {
  console.error("❌ 未设置 ARK_API_KEY，请在 .env 中配置");
  console.error("   获取地址：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey");
  process.exit(1);
}

/**
 * 调用方舟 Responses API 进行视频理解（支持时间戳感知）
 * @param {string} videoUrl - 视频公网 URL
 * @param {string} prompt - 理解任务 prompt
 * @param {number} fps - 抽帧频率，默认 1（每秒 1 帧），时序敏感任务可调高至 2-5
 */
async function understandVideo(videoUrl, prompt, fps = 1) {
  const body = {
    model: "doubao-seed-1-6-251015",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_video",
            video_url: videoUrl,
            fps,
          },
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  };

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * 从 Responses 响应中提取输出文本
 * 方舟 Responses API 结构：output 为数组，含 message 类型项，content 内为 output_text
 */
function extractOutputText(resp) {
  // output 数组
  const output = resp.output;
  if (output && Array.isArray(output)) {
    for (const item of output) {
      if (item.type === "message" && item.content) {
        const content = item.content;
        if (Array.isArray(content)) {
          const textPart = content.find((c) => c.type === "output_text");
          if (textPart?.text) return textPart.text;
        }
        if (typeof content === "string") return content;
      }
    }
  }
  // Chat 兼容结构
  const choice = resp.choices?.[0];
  if (choice?.message?.content) return choice.message.content;
  return null;
}

async function run() {
  console.log("火山引擎方舟 视频理解 API 测试（时间戳+文本）");
  console.log("Base URL:", ARK_BASE_URL);
  console.log("接口: POST /responses");
  console.log("模型: doubao-seed-1-6-251015");
  console.log("");

  console.log("--- 1. 测试视频 ---");
  console.log("URL:", DEFAULT_VIDEO_URL);
  console.log("");

  console.log("--- 2. 提交理解请求 ---");
  console.log("Prompt: 知识库视频解析（summary + segments + entities）");
  const start = Date.now();
  let resp;
  try {
    resp = await understandVideo(DEFAULT_VIDEO_URL, VIDEO_KB_PROMPT, 2);
  } catch (e) {
    console.error("\n❌ 请求失败:", e.message);
    process.exit(1);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ 请求完成，耗时 ${elapsed}s`);
  console.log("");

  console.log("--- 3. 解析结果 ---");
  const text = extractOutputText(resp);

  if (text) {
    // 尝试解析 JSON 并格式化展示
    try {
      let parsed = text.trim();
      // 去除可能的 markdown 代码块
      const jsonMatch = parsed.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) parsed = jsonMatch[1];
      const data = JSON.parse(parsed);

      if (data.summary) {
        console.log("\n--- 4. 整体摘要 ---");
        console.log("标题:", data.summary.title ?? "-");
        console.log("概述:", data.summary.overview ?? "-");
        console.log("时长:", data.summary.duration_seconds ?? "-", "秒");
        console.log("主题:", (data.summary.theme ?? []).join(", ") || "-");
        console.log("关键词:", (data.summary.keywords ?? []).join(", ") || "-");
      }

      if (data.segments && data.segments.length > 0) {
        console.log("\n--- 5. 时间戳分段（RAG 溯源） ---");
        data.segments.forEach((s, i) => {
          console.log(`\n  [${i + 1}] ${s.start_time ?? "-"} ~ ${s.end_time ?? "-"}`);
          console.log(`      内容: ${(s.content ?? "").slice(0, 120)}${(s.content?.length ?? 0) > 120 ? "..." : ""}`);
          if (s.entities?.length) console.log(`      实体: ${s.entities.join(", ")}`);
          if (s.events?.length) console.log(`      事件: ${s.events.join(", ")}`);
        });
      }

      if (data.entities) {
        console.log("\n--- 6. 关键实体汇总 ---");
        if (data.entities.people?.length) console.log("人物:", data.entities.people.join(" | "));
        if (data.entities.objects?.length) console.log("物体:", data.entities.objects.join(" | "));
        if (data.entities.locations?.length) console.log("场景:", data.entities.locations.join(" | "));
        if (data.entities.text_on_screen?.length) console.log("画面文字:", data.entities.text_on_screen.join(" | "));
      }

      console.log("\n--- 7. 原始 JSON ---");
      console.log(text);
    } catch {
      console.log(text);
    }
    console.log("\n--- 8. 统计 ---");
    console.log("输出字符数:", text.length);
    console.log("\n✅ 测试通过");
    process.exit(0);
  } else {
    console.log("(未找到 output 文本)");
    console.log("原始响应结构:", JSON.stringify(resp, null, 2).slice(0, 500) + "...");
    console.error("\n❌ 解析结果为空");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("\n❌ 测试失败:", e.message);
  process.exit(1);
});
