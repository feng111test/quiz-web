import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const OBJECTIVE_TYPES = ["single", "multiple", "judge"];
const SUBJECTIVE_TYPE = "subjective";
const TYPE_KEYS = [...OBJECTIVE_TYPES, SUBJECTIVE_TYPE];

function hasAnswer(value) {
  if (Array.isArray(value)) return value.some((item) => String(item ?? "").trim());
  return Boolean(String(value ?? "").trim());
}

// 网页刷题支持客观题（单选/多选/判断）与主观题（填空/简答/计算等统一为 subjective）
function keepQuestion(question) {
  if (!question || typeof question !== "object") return false;
  if (!hasAnswer(question.answer)) return false;
  if (question.type === SUBJECTIVE_TYPE) return true;
  return (
    OBJECTIVE_TYPES.includes(question.type) &&
    Array.isArray(question.options) &&
    question.options.length >= 2
  );
}

function typeStatOf(questions) {
  const stat = { single: 0, multiple: 0, judge: 0, subjective: 0 };
  questions.forEach((question) => {
    if (stat[question.type] !== undefined) stat[question.type] += 1;
  });
  return stat;
}

const packedData = await readFile(join(bankSource, mixedBank.file));
const outputDir = join(webRoot, "public", "builtin-data");
// 产物目录整体重建，避免旧的分卷文件残留
await rm(outputDir, { recursive: true, force: true });
await mkdir(join(outputDir, "banks"), { recursive: true });

const index = [];
let actualCount = 0;
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
  // 每份试卷单独作为一套默认题库，便于按卷选择和统计
  const questions = data.questions
    .filter(keepQuestion)
    .map((question) => ({ ...question, region: question.region || region.region }));
  if (!questions.length) continue;

  const bankId = `builtin-${region.id}`;
  // 按卷拆成独立文件：选题页只读索引，开始刷题时才下载对应的卷
  const file = `banks/bank-${index.length + 1}.json`;
  const payload = JSON.stringify({ bankId, name: region.name, questions });
  await writeFile(join(outputDir, `${file}.gz`), gzipSync(payload, { level: 9 }));
  await writeFile(join(outputDir, file), payload);

  index.push({
    id: bankId,
    name: region.name,
    desc: region.desc,
    region: region.region,
    questionCount: questions.length,
    typeStat: typeStatOf(questions),
    file,
  });
  actualCount += questions.length;
}

const expectedCount = TYPE_KEYS.reduce((sum, key) => sum + Number(mixedBank.typeStat?.[key] || 0), 0);
if (actualCount !== expectedCount) {
  throw new Error(`网页默认题库题量校验失败：预期 ${expectedCount}，实际 ${actualCount}`);
}

await writeFile(
  join(outputDir, "index.json"),
  JSON.stringify({ generatedAt: Date.now(), banks: index }),
);

console.log(`已生成网页默认题库：${index.length} 份试卷，共 ${actualCount} 道题`);
console.log(
  index
    .map((bank) => {
      const stat = bank.typeStat;
      return `  ${bank.name} ${bank.questionCount} 题（单选 ${stat.single} · 多选 ${stat.multiple} · 判断 ${stat.judge} · 主观 ${stat.subjective}）`;
    })
    .join("\n"),
);
console.log(`索引文件：${join(outputDir, "index.json")}`);
