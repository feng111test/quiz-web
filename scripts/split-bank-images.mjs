/**
 * 对已生成的分卷补做「图片外置」：把内嵌 base64 图片抽成独立文件。
 *
 * 正常情况下 npm run build（内部会跑 prepare-default-bank.mjs）已经直接生成外置图片的分卷，
 * 这个脚本用于：手头已有旧版分卷、不想重新生成题库时，原地转换一次。
 *
 * 用法：
 *   node scripts/split-bank-images.mjs              # 处理全部卷
 *   node scripts/split-bank-images.mjs --dry-run    # 只看体积变化，不写文件
 *   node scripts/split-bank-images.mjs bank-1       # 只处理指定卷
 *
 * 原始文件会备份到 server/data/bank-original/（已被 .gitignore 忽略，不会进发布包）。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { externalizeBankImages } from "./lib/bank-images.mjs";

const root = process.cwd();
const banksDir = path.join(root, "public", "builtin-data", "banks");
const builtinDir = path.join(root, "public", "builtin-data");
const backupDir = path.join(root, "server", "data", "bank-original");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.filter((item) => !item.startsWith("--"));

function readBank(slug) {
  const gzPath = path.join(banksDir, `${slug}.json.gz`);
  const jsonPath = path.join(banksDir, `${slug}.json`);
  if (fs.existsSync(gzPath)) {
    return { data: JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf8")), gzPath, jsonPath };
  }
  if (fs.existsSync(jsonPath)) {
    return { data: JSON.parse(fs.readFileSync(jsonPath, "utf8")), gzPath, jsonPath };
  }
  return null;
}

function main() {
  if (!fs.existsSync(banksDir)) throw new Error(`没找到 ${banksDir}`);
  const slugs = fs
    .readdirSync(banksDir)
    .filter((name) => name.startsWith("bank-") && name.endsWith(".json.gz"))
    .map((name) => name.replace(/\.json\.gz$/, ""))
    .filter((slug) => (only.length ? only.includes(slug) : true))
    .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));

  if (!slugs.length) throw new Error("没有找到可分卷的题库文件");
  if (!dryRun) fs.mkdirSync(backupDir, { recursive: true });

  const total = { before: 0, after: 0, images: 0, imageBytes: 0 };

  for (const slug of slugs) {
    const bank = readBank(slug);
    if (!bank) continue;

    const { questions, stats } = externalizeBankImages({
      questions: bank.data.questions || [],
      slug,
      outputDir: builtinDir,
      dryRun,
    });
    const payload = JSON.stringify({ ...bank.data, questions });
    const gzBytes = zlib.gzipSync(Buffer.from(payload, "utf8"), { level: 9 });
    const beforeBytes = fs.existsSync(bank.gzPath) ? fs.statSync(bank.gzPath).size : 0;

    total.before += beforeBytes;
    total.after += gzBytes.length;
    total.images += stats.images;
    total.imageBytes += stats.imageBytes;

    console.log(
      `${slug}: ${(beforeBytes / 1024).toFixed(0)}KB → ${(gzBytes.length / 1024).toFixed(0)}KB` +
        `（拆出 ${stats.images} 张图，${(stats.imageBytes / 1024 / 1024).toFixed(2)}MB）`,
    );

    if (dryRun) continue;
    if (fs.existsSync(bank.gzPath)) fs.copyFileSync(bank.gzPath, path.join(backupDir, `${slug}.json.gz`));
    if (fs.existsSync(bank.jsonPath)) fs.copyFileSync(bank.jsonPath, path.join(backupDir, `${slug}.json`));
    fs.writeFileSync(bank.gzPath, gzBytes);
    fs.writeFileSync(bank.jsonPath, payload);
  }

  console.log("---");
  console.log(`题库包合计: ${(total.before / 1024 / 1024).toFixed(2)}MB → ${(total.after / 1024).toFixed(0)}KB`);
  console.log(`拆出图片: ${total.images} 张，共 ${(total.imageBytes / 1024 / 1024).toFixed(2)}MB`);
  console.log(dryRun ? "（dry-run，未写入任何文件）" : `原始文件已备份到 ${backupDir}`);
}

main();
