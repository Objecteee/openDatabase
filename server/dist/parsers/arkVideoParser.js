/**
 * 火山引擎方舟 视频理解解析器
 *
 * 将视频通过方舟 Responses API（doubao-seed 模型）解析为结构化 Markdown，
 * 包含整体摘要、时间戳分段描述、关键实体，供后续 RAG 切片与溯源使用。
 *
 * 视频必须是公网可访问的 URL（从 Supabase Storage 获取签名 URL）。
 *
 * 环境变量：
 *   ARK_API_KEY  — 火山引擎方舟 API Key（必填）
 *   ARK_BASE_URL — 方舟 Base URL（默认 https://ark.cn-beijing.volces.com/api/v3）
 */
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_BASE_URL = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
const RESPONSES_URL = `${ARK_BASE_URL}/responses`;
const ARK_VIDEO_MODEL = process.env.ARK_VIDEO_MODEL || "doubao-seed-1-6-251015";
/** 视频 RAG 解析 Prompt：输出 summary + segments + entities 结构化 JSON */
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
/**
 * 通过方舟 Responses API 解析视频，返回结构化 Markdown。
 *
 * @param videoUrl  视频的公网可访问 URL（Supabase Storage 签名 URL）
 * @param fps       抽帧频率（默认 1fps，时序敏感内容可调高至 2）
 */
export async function parseVideoWithArk(videoUrl, fps = 1) {
    if (!ARK_API_KEY) {
        throw new Error("ARK_API_KEY 未配置，无法调用方舟视频理解 API");
    }
    console.log(`[arkVideoParser] 开始视频理解，fps=${fps}，URL: ${videoUrl.slice(0, 80)}...`);
    const response = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ARK_API_KEY}`,
        },
        body: JSON.stringify({
            model: ARK_VIDEO_MODEL,
            input: [
                {
                    role: "user",
                    content: [
                        { type: "input_video", video_url: videoUrl, fps },
                        { type: "input_text", text: VIDEO_KB_PROMPT },
                    ],
                },
            ],
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`方舟视频理解 API 请求失败 (${response.status}): ${text}`);
    }
    const resp = await response.json();
    // 从 Responses API 结构中提取文本
    const outputText = extractOutputText(resp);
    if (!outputText) {
        throw new Error("方舟视频理解 API 返回结果为空");
    }
    // 解析 JSON（去除可能的 markdown 代码块包裹）
    let jsonStr = outputText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch)
        jsonStr = jsonMatch[1].trim();
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    }
    catch {
        throw new Error(`方舟视频理解 API 返回内容无法解析为 JSON: ${jsonStr.slice(0, 200)}`);
    }
    console.log(`[arkVideoParser] 视频理解完成，共 ${parsed.segments?.length ?? 0} 个时间段`);
    return {
        markdown: buildVideoMarkdown(parsed),
        raw: parsed,
    };
}
/**
 * 将结构化 JSON 转为 Markdown，保留时间戳信息供 RAG 溯源。
 * 格式：整体摘要 → 时间戳分段 → 实体汇总
 */
function buildVideoMarkdown(data) {
    const lines = [];
    // 整体摘要
    const s = data.summary ?? {};
    lines.push(`# ${s.title || "视频内容"}`);
    lines.push("");
    if (s.overview) {
        lines.push("## 整体概述");
        lines.push("");
        lines.push(s.overview);
        lines.push("");
    }
    if (s.duration_seconds) {
        lines.push(`**时长**：${formatDuration(s.duration_seconds)}`);
    }
    if (s.theme?.length) {
        lines.push(`**主题**：${s.theme.join("、")}`);
    }
    if (s.keywords?.length) {
        lines.push(`**关键词**：${s.keywords.join("、")}`);
    }
    lines.push("");
    // 时间戳分段（RAG 溯源核心）
    const segments = data.segments ?? [];
    if (segments.length > 0) {
        lines.push("## 时间戳内容分段");
        lines.push("");
        for (const seg of segments) {
            lines.push(`### [${seg.start_time} ~ ${seg.end_time}]`);
            lines.push("");
            lines.push(seg.content || "");
            if (seg.entities?.length) {
                lines.push("");
                lines.push(`**出现实体**：${seg.entities.join("、")}`);
            }
            if (seg.events?.length) {
                lines.push(`**发生事件**：${seg.events.join("、")}`);
            }
            lines.push("");
        }
    }
    // 实体汇总
    const entities = data.entities ?? {};
    const hasEntities = [entities.people, entities.objects, entities.locations, entities.text_on_screen].some((a) => a?.length);
    if (hasEntities) {
        lines.push("## 关键实体汇总");
        lines.push("");
        if (entities.people?.length)
            lines.push(`**人物**：${entities.people.join("、")}`);
        if (entities.objects?.length)
            lines.push(`**物体**：${entities.objects.join("、")}`);
        if (entities.locations?.length)
            lines.push(`**场景**：${entities.locations.join("、")}`);
        if (entities.text_on_screen?.length)
            lines.push(`**画面文字**：${entities.text_on_screen.join("、")}`);
        lines.push("");
    }
    return lines.join("\n");
}
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0)
        return `${h}小时${m}分${s}秒`;
    if (m > 0)
        return `${m}分${s}秒`;
    return `${s}秒`;
}
function extractOutputText(resp) {
    const output = resp.output;
    if (Array.isArray(output)) {
        for (const item of output) {
            if (item.type === "message" && item.content) {
                const content = item.content;
                if (Array.isArray(content)) {
                    const textPart = content.find((c) => c.type === "output_text");
                    if (textPart?.text)
                        return textPart.text;
                }
                if (typeof content === "string")
                    return content;
            }
        }
    }
    const choices = resp.choices;
    const choice = choices?.[0];
    const message = choice?.message;
    if (message?.content)
        return message.content;
    return null;
}
