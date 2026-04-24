import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(serverRoot, "..");

const sourceDir = path.join(projectRoot, "client", "dist");
const targetDir = path.join(serverRoot, "dist", "public");

async function ensureSourceExists() {
  try {
    const stat = await fs.stat(sourceDir);
    if (!stat.isDirectory()) {
      throw new Error(`前端构建产物不是目录: ${sourceDir}`);
    }
  } catch {
    throw new Error(`未找到前端构建产物，请先执行 client 构建: ${sourceDir}`);
  }
}

async function copyBuild() {
  await ensureSourceExists();
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  console.log(`已复制前端构建产物: ${sourceDir} -> ${targetDir}`);
}

copyBuild().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
