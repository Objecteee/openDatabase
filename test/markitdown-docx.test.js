/**
 * 302.ai Markitdown API 测试 - Word (docx) 转 Markdown
 * 价格：0.01 PTC/1M Token
 * 文档：POST https://api.302.ai/302/markitdown/convert
 *
 * 运行：node test/markitdown-docx.test.js
 * 指定本地文件：DOCX_FILE=/path/to/file.docx node test/markitdown-docx.test.js
 * 指定远程 URL：DOCX_URL=https://xxx.docx node test/markitdown-docx.test.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.302.ai").replace(/\/$/, "");
const MARKITDOWN_URL = `${AI_BASE_URL}/302/markitdown/convert`;

if (!AI_API_KEY) {
  console.error("❌ 未设置 AI_API_KEY，请在 server/.env 中配置");
  process.exit(1);
}

/**
 * 通过本地文件调用 Markitdown API
 * @param {string} filePath - 本地 docx 文件路径
 */
async function convertDocxFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append("source_data_type", "file");
  formData.append("file", new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);

  const res = await fetch(MARKITDOWN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: formData,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${rawText}`);
  }

  // 尝试 JSON 解析，失败则直接当作 Markdown 文本返回
  try {
    return JSON.parse(rawText);
  } catch {
    return { data: rawText };
  }
}

/**
 * 通过远程 URL 调用 Markitdown API（source_data_type=url）
 * @param {string} url - docx 文件的公开 URL
 */
async function convertDocxUrl(url) {
  const formData = new FormData();
  formData.append("source_data_type", "url");
  formData.append("source_data", url);

  const res = await fetch(MARKITDOWN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: formData,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${rawText}`);
  }

  // 尝试 JSON 解析，失败则直接当作 Markdown 文本返回
  try {
    return JSON.parse(rawText);
  } catch {
    return { data: rawText };
  }
}

async function run() {
  console.log("302.ai Markitdown API 测试 - Word (docx) 转 Markdown");
  console.log("接口: POST", MARKITDOWN_URL);
  console.log("价格: 0.01 PTC/1M Token");
  console.log("");

  const localFile = process.env.DOCX_FILE;
  const remoteUrl = process.env.DOCX_URL;

  let result;
  let start;

  if (localFile) {
    // 使用本地文件
    if (!fs.existsSync(localFile)) {
      console.error(`❌ 文件不存在: ${localFile}`);
      process.exit(1);
    }
    const stat = fs.statSync(localFile);
    console.log(`--- 1. 测试本地文件 ---`);
    console.log(`文件: ${localFile}`);
    console.log(`大小: ${(stat.size / 1024).toFixed(1)} KB`);
    console.log("");

    console.log("--- 2. 提交转换请求 ---");
    start = Date.now();
    result = await convertDocxFile(localFile);
  } else if (remoteUrl) {
    // 使用远程 URL
    console.log(`--- 1. 测试远程 URL ---`);
    console.log(`URL: ${remoteUrl}`);
    console.log("");

    console.log("--- 2. 提交转换请求 ---");
    start = Date.now();
    result = await convertDocxUrl(remoteUrl);
  } else {
    // 使用内置的示例 docx URL（微软官方示例文档）
    const sampleUrl = "https://calibre-ebook.com/downloads/demos/demo.docx";
    console.log(`--- 1. 测试示例 docx（微软 Word 示例文档）---`);
    console.log(`URL: ${sampleUrl}`);
    console.log("(可通过 DOCX_FILE=/path/to/file.docx 或 DOCX_URL=https://xxx.docx 指定文件)");
    console.log("");

    console.log("--- 2. 提交转换请求 ---");
    start = Date.now();
    result = await convertDocxUrl(sampleUrl);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ 请求完成，耗时 ${elapsed}s`);
  console.log("");

  console.log("--- 3. 转换结果 ---");
  const mdText = result?.data ?? "";

  if (!mdText || !mdText.trim()) {
    console.error("❌ 返回内容为空");
    console.log("原始响应:", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`Markdown 长度: ${mdText.length} 字符`);
  console.log(`行数: ${mdText.split("\n").length} 行`);
  console.log("");

  // 输出前 3000 字符预览
  const preview = mdText.length > 3000 ? mdText.slice(0, 3000) + "\n\n...(已截断，共 " + mdText.length + " 字符)" : mdText;
  console.log("--- Markdown 内容预览 ---");
  console.log(preview);

  // 分析 Markdown 结构
  console.log("\n--- 4. 结构分析 ---");
  const lines = mdText.split("\n");
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l));
  const tables = mdText.match(/\|.*\|/g) ?? [];
  const codeBlocks = (mdText.match(/```/g) ?? []).length / 2;
  const images = (mdText.match(/!\[.*?\]\(.*?\)/g) ?? []).length;
  const links = (mdText.match(/\[.*?\]\(.*?\)/g) ?? []).length;

  console.log(`标题数量: ${headings.length}`);
  if (headings.length > 0) {
    headings.slice(0, 5).forEach((h) => console.log(`  ${h}`));
    if (headings.length > 5) console.log(`  ...(共 ${headings.length} 个标题)`);
  }
  console.log(`表格行数: ${tables.length}`);
  console.log(`代码块数量: ${Math.floor(codeBlocks)}`);
  console.log(`图片数量: ${images}`);
  console.log(`链接数量: ${links}`);

  // 保存结果到文件
  const outputPath = path.join(__dirname, "markitdown-output.md");
  fs.writeFileSync(outputPath, mdText, "utf-8");
  console.log(`\n✓ 完整 Markdown 已保存至: ${outputPath}`);

  console.log("\n✅ 测试通过 - Markitdown API 可正常使用");
  process.exit(0);
}

run().catch((e) => {
  console.error("\n❌ 测试失败:", e.message);
  if (e.message.includes("fetch")) {
    console.error("提示：请检查网络连接和 AI_API_KEY 配置");
  }
  process.exit(1);
});
