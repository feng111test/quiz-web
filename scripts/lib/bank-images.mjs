/**
 * 题库图片外置：把题目里的内嵌 base64 图片写成独立文件，JSON 里只留相对路径。
 *
 * 内嵌图片占了分卷体积的 99%（如 bank-1 解压后 2.97MB，其中 2.95MB 是图片），
 * 刷题时必须整包下载完才能显示第一题。外置后分卷只有十几 KB，
 * 图片由浏览器按当前题目的需要单独加载。
 *
 * 被 scripts/prepare-default-bank.mjs（生成题库时）和
 * scripts/split-bank-images.mjs（对已有分卷补做转换）共用。
 */
import fs from "node:fs";
import path from "node:path";

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

/** 题目里存放图片的对象字段（tableImage 是单个对象，其余是数组） */
const IMAGE_FIELDS = ["images", "titleImages", "formulaImages", "explanationImages"];
const SINGLE_IMAGE_FIELDS = ["tableImage"];

function splitDataUrl(value) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(value);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

/**
 * @param {object}  options
 * @param {Array}   options.questions 原始题目数组
 * @param {string}  options.slug      分卷标识，如 bank-1
 * @param {string}  options.outputDir builtin-data 目录（图片会写到其下的 images/<slug>/）
 * @param {boolean} [options.dryRun]  只统计不写文件
 * @returns {{ questions: Array, stats: { images: number, imageBytes: number } }}
 */
export function externalizeBankImages({ questions, slug, outputDir, dryRun = false }) {
  const stats = { images: 0, imageBytes: 0 };

  const extract = (entry, qid, field, indexInField) => {
    const value = typeof entry === "string" ? entry : entry?.dataUrl || entry?.src || "";
    const parsed = splitDataUrl(value);
    if (!parsed) return entry;

    const ext = EXT_BY_MIME[parsed.mime] || "png";
    const fileName = `${qid}-${field}-${indexInField}.${ext}`;
    const relPath = `images/${slug}/${fileName}`;
    const bytes = Buffer.from(parsed.base64, "base64");

    if (!dryRun) {
      const absPath = path.join(outputDir, "images", slug, fileName);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, bytes);
    }
    stats.images += 1;
    stats.imageBytes += bytes.length;

    return typeof entry === "string" ? relPath : { ...entry, dataUrl: relPath, src: relPath };
  };

  const next = questions.map((raw, index) => {
    const qid = `q${String(index + 1).padStart(3, "0")}`;
    let out = raw;
    const set = (key, value) => {
      out = { ...out, [key]: value };
    };

    for (const field of IMAGE_FIELDS) {
      const list = out[field];
      if (!Array.isArray(list) || !list.length) continue;
      set(field, list.map((entry, i) => extract(entry, qid, field, i)));
    }
    for (const field of SINGLE_IMAGE_FIELDS) {
      if (!out[field]) continue;
      set(field, extract(out[field], qid, field, 0));
    }
    if (Array.isArray(out.options)) {
      set(
        "options",
        out.options.map((option) => {
          if (!option || !Array.isArray(option.formulaImages)) return option;
          return {
            ...option,
            // 带上选项标号，避免与题目顶层的 formulaImages 文件名冲突
            formulaImages: option.formulaImages.map((entry, i) =>
              extract(entry, qid, `opt${option.key || i}-formulaImages`, i),
            ),
          };
        }),
      );
    }
    return out;
  });

  return { questions: next, stats };
}
