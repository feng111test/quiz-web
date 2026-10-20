import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 题库源数据随本工程一起维护，不再依赖小程序仓库
const bankSource = resolve(webRoot, "data", "builtin-chemistry");
const manifest = JSON.parse(await readFile(join(bankSource, "manifest.json"), "utf8"));
const [mixedBank, ...regions] = manifest.banks || [];
if (!mixedBank || !regions.length) {
  throw new Error("内置化学题库目录为空，无法生成网页默认题库");
}

const packedData = await readFile(join(bankSource, mixedBank.file));
const banks = [];
for (const region of regions) {
  const start = Number(region.offset);
  const end = start + Number(region.compressedSize);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > packedData.length) {
    throw new Error(`内置题库分卷位置无效：${region.id}`);
  }
  const data = JSON.parse(gunzipSync(packedData.subarray(start, end)).toString("utf8"));
  if (!Array.isArray(data.questions) || data.questions.length !== region.questionCount) {
    throw new Error(`内置题库分卷题量不匹配：${region.id}`);
  }
  // 网页刷题只支持客观题；每份试卷单独作为一套默认题库，便于按卷选择和统计
  const questions = data.questions
    .filter(
      (question) =>
        ["single", "multiple", "judge"].includes(question.type) &&
        question.answer &&
        Array.isArray(question.options) &&
        question.options.length >= 2,
    )
    .map((question) => ({
      ...question,
      region: question.region || region.region,
    }));
  if (!questions.length) continue;
  banks.push({
    id: `builtin-${region.id}`,
    name: region.name,
    desc: region.desc,
    region: region.region,
    questionCount: questions.length,
    questions,
  });
}

const expectedCount =
  Number(mixedBank.typeStat?.single || 0) +
  Number(mixedBank.typeStat?.multiple || 0) +
  Number(mixedBank.typeStat?.judge || 0);
const actualCount = banks.reduce((sum, bank) => sum + bank.questions.length, 0);
if (actualCount !== expectedCount) {
  throw new Error(`网页默认题库题量校验失败：预期 ${expectedCount}，实际 ${actualCount}`);
}

const payload = JSON.stringify({
  generatedAt: Date.now(),
  banks,
});
const outputDir = join(webRoot, "public", "builtin-data");
await mkdir(outputDir, { recursive: true });
// 同时输出压缩包与纯文本：浏览器不支持 gzip 流式解压时还能退回纯文本
const gzPath = join(outputDir, "2026-chemistry-banks.json.gz");
const jsonPath = join(outputDir, "2026-chemistry-banks.json");
await writeFile(gzPath, gzipSync(payload, { level: 9 }));
await writeFile(jsonPath, payload);

// 清掉旧版单卷文件，避免构建产物里残留
await unlink(join(outputDir, "2026-chemistry-mixed.json.gz")).catch(() => {});
await unlink(join(outputDir, "2026-chemistry-mixed.json")).catch(() => {});

console.log(`已生成网页默认题库：${banks.length} 份试卷，共 ${actualCount} 道题`);
console.log(banks.map((bank) => `  ${bank.name} ${bank.questionCount} 题`).join("\n"));
console.log(`输出文件：${gzPath}`);
console.log(`输出文件：${jsonPath}`);
