/**
 * 生成复杂测试 PDF（多页、多段落、列表结构）
 * 运行：node scripts/generate-sample-pdf.js
 * 输出：samples/complex-sample.pdf
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "samples");
const OUT_FILE = path.join(OUT_DIR, "complex-sample.pdf");

const CONTENT = [
  {
    title: "Chapter 1: Project Overview",
    paragraphs: [
      "This project builds a full-stack knowledge base application supporting document upload, parsing, chunking, vectorization, and RAG dialogue. Tech stack: React 19, Vite, Tailwind CSS, Node.js Express, Supabase.",
      "Core flow: User uploads documents -> Parse to text -> Chunk by paragraph or fixed length -> Local or cloud Embedding -> Write to pgvector -> Vector search on user query -> Inject context and call Chat API.",
      "Supported formats: txt, md, pdf, docx. Txt and md use native parsing; pdf and docx require external APIs or libraries.",
    ],
  },
  {
    title: "Chapter 2: Chunking Strategy",
    paragraphs: [
      "Text chunking uses paragraph-first: split by double newline, short paragraphs (<=500 chars) as one chunk, long ones split at 500 chars with 50-char overlap for context.",
      "For PDF, keep page numbers in metadata for citation. For video/audio, segment by timestamp, metadata stores timestamp (hh:mm:ss).",
      "Chunk content is plain text; metadata is jsonb with page, timestamp, chunk_index, etc.",
    ],
  },
  {
    title: "Chapter 3: Citation",
    paragraphs: [
      "AI replies must carry source pointer [source_id, pointer], pointer to PDF page or video timestamp.",
      "messages table has citations field: [{ chunk_id, document_id, pointer }].",
      "Frontend shows citation sources; user can click to jump to the referenced position.",
    ],
  },
];

async function main() {
  const doc = await PDFDocument.create();
  doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 750;
  const lineHeight = 18;
  const margin = 50;
  const pageWidth = 595;
  const textWidth = pageWidth - margin * 2;

  function getCurrentPage() {
    return doc.getPages()[doc.getPageCount() - 1];
  }

  for (const section of CONTENT) {
    if (y < 100) {
      doc.addPage();
      y = 750;
    }
    const page = getCurrentPage();

    page.drawText(section.title, {
      x: margin,
      y,
      size: 14,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.5),
    });
    y -= lineHeight * 1.5;

    for (const text of section.paragraphs) {
      const lines = wrapText(text, textWidth, font, 11);
      for (const line of lines) {
        if (y < 50) {
          doc.addPage();
          y = 750;
        }
        getCurrentPage().drawText(line, { x: margin, y, size: 11, font });
        y -= lineHeight;
      }
      y -= lineHeight * 0.5;
    }
    y -= lineHeight;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pdfBytes = await doc.save();
  fs.writeFileSync(OUT_FILE, pdfBytes);
  console.log("已生成:", OUT_FILE);
  console.log("文件大小:", (pdfBytes.length / 1024).toFixed(1), "KB");
}

/** 简单换行（中文约 42 字/行） */
function wrapText(text, _maxWidth, _font, _size) {
  const charsPerLine = 42;
  const lines = [];
  for (let i = 0; i < text.length; i += charsPerLine) {
    lines.push(text.slice(i, i + charsPerLine));
  }
  return lines;
}

main().catch(console.error);
