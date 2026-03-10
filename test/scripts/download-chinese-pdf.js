/**
 * 下载复杂中文 PDF（HSK 考试大纲：多页、表格、复杂排版）
 * 运行：node scripts/download-chinese-pdf.js
 * 输出：samples/hsk-syllabus.pdf
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "samples");
const OUT_FILE = path.join(OUT_DIR, "hsk-syllabus.pdf");

/** HSK 新版考试大纲（词汇、汉字、语法，含表格） */
const HSK_PDF_URL =
  "https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B2%EF%BC%88%E8%AF%8D%E6%B1%87%E3%80%81%E6%B1%89%E5%AD%97%E3%80%81%E8%AF%AD%E6%B3%95%EF%BC%89.pdf";

async function main() {
  console.log("下载 HSK 考试大纲 PDF...");
  console.log("URL:", HSK_PDF_URL);
  if (HSK_PDF_URL.length > 80) {
    console.log("(URL 已截断显示)");
  }

  const res = await fetch(HSK_PDF_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, buffer);

  console.log("已保存:", OUT_FILE);
  console.log("文件大小:", (buffer.length / 1024).toFixed(1), "KB");
}

main().catch((e) => {
  console.error("下载失败:", e.message);
  process.exit(1);
});
