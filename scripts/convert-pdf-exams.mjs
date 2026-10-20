import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const REGIONS = [
  "上海", "云南", "北京", "四川", "山东", "广东", "江苏", "江西",
  "河北", "河南", "湖北", "湖南", "贵州", "重庆", "陕晋青宁", "黑吉辽蒙",
];
const DEFAULT_INPUT = "F:/2026年高考化学真题（全国各地共22省）";
const DEFAULT_OUTPUT = path.join(DEFAULT_INPUT, "题库JSON");
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_OUTPUT_TOKENS = 8192;
const STUDENT_PAGES_PER_REQUEST = 1;
const CONVERTER_VERSION = "2026-10-23";
const VERIFIED_PDF_CORRECTIONS = {
  云南: {
    "18:4": { answer: "见答案图", page: 8, box: [84, 23, 560, 132] },
    "18:5": { answer: "CH3CH2OH" },
    "18:6": { answer: "作氧化剂，将醇羟基氧化为醛基" },
    "18:7": { answer: "2" },
    "18:8": { answer: "如答案图所示（任写一种）", page: 8, box: [168, 165, 522, 96] },
    "18:9": { answer: "见答案图", page: 8, box: [79, 247, 866, 96] },
  },
};
const renderedDocuments = new Map();

class OutputTokenLimitError extends Error {}
class InputTokenLimitError extends Error {}
class IncompleteQuestionError extends Error {
  constructor(paperNumber, partNumber) {
    super(`客观题（${paperNumber}${partNumber ? `(${partNumber})` : ""}）缺少选项`);
    this.paperNumber = paperNumber;
    this.partNumber = partNumber;
  }
}

function parseArgs(args) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, dryRun: false, overwrite: false, regions: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--overwrite") options.overwrite = true;
    else if (argument === "--input" || argument === "--output" || argument === "--region") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} 后需要填写路径`);
      if (argument === "--region") options.regions = value.split(/[，,]/).map((region) => region.trim()).filter(Boolean);
      else options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return options;
}

function printHelp() {
  console.log([
    "本机提取 PDF 文字并渲染页面，再按地区调用视觉 AI 兼容接口生成含公式/图示裁剪图的题库 JSON。",
    "",
    "用法：",
    "  node scripts/convert-pdf-exams.mjs [--dry-run] [--overwrite]",
    "    [--region <地区[,地区...]>] [--input <PDF目录>] [--output <JSON目录>]",
    "",
    "环境变量：",
    "  VISION_API_KEY       视觉模型 API Key（必填；也可用 GEMINI_API_KEY）",
    "  AI_API_BASE_URL      API 地址（默认 Gemini OpenAI 兼容接口）",
    "  AI_MODEL             模型名（默认 gemini-3.8-flash）",
    "  AI_REPAIR_MODEL      缺题/错题定向重识别模型（可选；默认使用 AI_MODEL）",
  ].join("\n"));
}

async function findPdfs(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) !== path.resolve(DEFAULT_OUTPUT)) await walk(fullPath);
      } else if (/\.pdf$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await walk(directory);
  return files.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function regionFromName(fileName) {
  return REGIONS.find((region) => fileName.includes(region));
}

function editionFromName(fileName) {
  return /答案|解析|answer|solution/i.test(fileName) ? "answer" : "student";
}

function textLinesFromPage(content) {
  const lines = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str?.trim()) continue;
    const y = item.transform?.[5] || 0;
    const x = item.transform?.[4] || 0;
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - y) > 2.5) {
      line = { y, text: "", lastRight: x, fontSize: Math.abs(item.transform?.[0] || 0) };
      lines.push(line);
    }
    const gap = x - line.lastRight;
    if (line.text && gap > Math.max(2, line.fontSize * 0.3)) line.text += " ";
    line.text += item.str.trim();
    line.lastRight = x + (item.width || 0);
  }
  return lines.map((line) => line.text.trim()).filter(Boolean).join("\n");
}

async function extractPdf(filePath) {
  const data = new Uint8Array(await readFile(filePath));
  const document = await getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = textLinesFromPage(await page.getTextContent());
      pages.push({ pageNumber, pageCount: document.numPages, text, pdfPath: filePath });
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

function loadRenderedDocument(filePath) {
  return readFile(filePath)
    .then((data) => getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise);
}

async function renderPdfPage(pageReference) {
  let documentPromise = renderedDocuments.get(pageReference.pdfPath);
  if (!documentPromise) {
    documentPromise = loadRenderedDocument(pageReference.pdfPath);
    renderedDocuments.set(pageReference.pdfPath, documentPromise);
  }

  let document = await documentPromise;
  if (pageReference.pageCount && document.numPages !== pageReference.pageCount) {
    await document.destroy();
    documentPromise = loadRenderedDocument(pageReference.pdfPath);
    renderedDocuments.set(pageReference.pdfPath, documentPromise);
    document = await documentPromise;
    if (document.numPages !== pageReference.pageCount) {
      throw new Error(
        `PDF 在文字提取后发生变化：「${path.basename(pageReference.pdfPath)}」提取时 ${pageReference.pageCount} 页，重新读取后 ${document.numPages} 页。请确认没有在转换期间移动或替换该文件，然后重跑。`,
      );
    }
  }

  if (!Number.isInteger(pageReference.pageNumber) || pageReference.pageNumber < 1
    || pageReference.pageNumber > document.numPages) {
    throw new Error(
      `PDF 页码无效：${pageReference.edition}版「${path.basename(pageReference.pdfPath)}」第 ${pageReference.pageNumber} 页；提取时共 ${pageReference.pageCount ?? "未知"} 页，重新读取后共 ${document.numPages} 页。`,
    );
  }

  let page;
  try {
    page = await document.getPage(pageReference.pageNumber);
  } catch (error) {
    throw new Error(
      `无法读取 ${pageReference.edition}版「${path.basename(pageReference.pdfPath)}」第 ${pageReference.pageNumber} 页（PDF 共 ${document.numPages} 页）：${error.message}`,
      { cause: error },
    );
  }
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1.8, 1500 / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return {
    canvas,
    dataUrl: canvas.toDataURL("image/jpeg", 0.82),
    edition: pageReference.edition,
    pageNumber: pageReference.pageNumber,
  };
}

async function closeRenderedDocuments(filePaths) {
  for (const filePath of filePaths) {
    const documentPromise = renderedDocuments.get(filePath);
    if (!documentPromise) continue;
    renderedDocuments.delete(filePath);
    const document = await documentPromise;
    await document.destroy();
  }
}

async function collectExams(inputDirectory, selectedRegions = []) {
  const files = await findPdfs(inputDirectory);
  if (!files.length) throw new Error(`目录中没有 PDF 文件：${inputDirectory}`);

  const hashes = new Set();
  const exams = new Map();
  let duplicateCount = 0;
  for (const filePath of files) {
    const bytes = await readFile(filePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(hash)) {
      duplicateCount += 1;
      continue;
    }
    hashes.add(hash);

    const fileName = path.basename(filePath);
    const region = regionFromName(fileName);
    if (!region) {
      console.warn(`跳过无法识别地区的 PDF：${fileName}`);
      continue;
    }
    if (selectedRegions.length && !selectedRegions.includes(region)) continue;
    const pages = await extractPdf(filePath);
    const edition = editionFromName(fileName);
    pages.forEach((page) => {
      page.edition = edition;
    });
    const exam = exams.get(region) || { region, editions: { student: [], answer: [] } };
    exam.editions[edition].push({ fileName, pages, hash });
    exams.set(region, exam);
  }
  return { files, duplicateCount, exams };
}

function formatEdition(edition, files, selectedPages) {
  if (!files.length) return `【${edition}版 PDF 缺失】`;
  return files.map(({ fileName, pages }) => [
    `【文件：${fileName}】`,
    ...pages
      .filter(({ pageNumber }) => !selectedPages || selectedPages.has(pageNumber))
      .map(({ pageNumber, text }) => `【PDF第${pageNumber}页】\n${text || "（本页未提取到可选文字）"}`),
  ].join("\n")).join("\n\n");
}

function questionNumbersFromText(text) {
  const numbers = new Set([
    [...text.matchAll(/(?:^|\s)(?:第\s*)?(\d{1,2})(?:\s*题\s*[:：.．、)]?\s*|[.．、)）:：]\s*)(?=[\u4e00-\u9fffA-Za-z（(【\[“‘「『①-⑩])/gm)]
      .map((match) => match[1]),
    // Some question stems begin with a number, such as “9. 1-环己基…” or “14. 25 °C…”.
    [...text.matchAll(/(?:^|\s)(\d{1,2})[.．]\s+(?=\d)/gm)]
      .map((match) => match[1]),
  ].flat());
  return [...numbers].filter((number) => Number(number) > 0);
}

function isAnswerKeyPage(page) {
  return /参考答案|【\s*\d+\s*[~～—-]\s*\d+\s*题答案\s*】/.test(page.text)
    && /【\s*答案\s*】|参考答案/.test(page.text);
}

function studentQuestionPages(exam) {
  let insideAnswerAppendix = false;
  return exam.editions.student.flatMap(({ pages }) => pages).filter((page) => {
    if (isAnswerKeyPage(page)) {
      insideAnswerAppendix = true;
      return false;
    }
    if (insideAnswerAppendix && !/化学试卷|化学考试/.test(page.text)) return false;
    return true;
  });
}

function findRelevantAnswerPages(exam, targetPages) {
  const studentPages = exam.editions.student.flatMap(({ pages }) => pages);
  const questionNumbers = new Set(targetPages.flatMap(({ text }) => questionNumbersFromText(text)));
  if (!questionNumbers.size && targetPages.length) {
    const firstIndex = studentPages.findIndex((page) => page.pageNumber === targetPages[0].pageNumber);
    for (let index = firstIndex - 1; index >= 0 && !questionNumbers.size; index -= 1) {
      questionNumbersFromText(studentPages[index].text).forEach((number) => questionNumbers.add(number));
    }
  }
  if (!questionNumbers.size) return [];

  const scores = exam.editions.answer.flatMap(({ pages }) =>
    pages.map((page) => {
      const score = [...questionNumbers].filter((number) =>
        new RegExp(`(?:^|[^\\d])${number}(?:[.．、)）:：]|\\s+[A-D正确错误])`).test(page.text),
      ).length;
      return { page, score };
    }),
  );
  return scores
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.page.pageNumber - right.page.pageNumber)
    .slice(0, 2)
    .map(({ page }) => page);
}

function promptForExam(
  exam,
  targetPages,
  contextPages,
  answerPages,
  imagePages,
  { focusQuestionNumber, focusPartNumber, concise },
) {
  const targetPageNumbers = new Set(targetPages.map(({ pageNumber }) => pageNumber));
  const pageRange = targetPages.length === 1
    ? `第 ${targetPages[0].pageNumber} 页`
    : `第 ${targetPages[0].pageNumber}-${targetPages.at(-1).pageNumber} 页`;
  return [
    "你是高考试卷题库整理助手。根据试卷文字和随请求附带的学生版、答案版页面图片，输出一个 JSON 对象，不要 Markdown 或额外说明。",
    '格式：{"questions":[{"paperNumber":"24","partNumber":"1","type":"single|multiple|judge|subjective","title":"本小题题干","options":[{"key":"A","content":"选项"}],"answer":"答案原文","explanation":"解析或空字符串","sourcePage":1,"figures":[{"edition":"student|answer","page":1,"role":"title|option:A|explanation","box":[100,200,300,100]}]}]}',
    "要求：",
    "1. 仅整理学生版中实际存在且可独立作答的最小小题，答案和解析只能从答案版原文提取，不得猜答案。选择题答案为选项字母，填空/计算/实验题 type 为 subjective，answer 保留完整参考答案原文。若原卷有答案但本次看不清，使用【需核对原图】而不要留空。",
    "2. paperNumber 必须是卷面最近的阿拉伯数字大题号；partNumber 为该题内部的括号/圈号小题号（如第24题第(2)问填 partNumber=2；没有内部小题号则空字符串）。不同小题不得重复同一 paperNumber+partNumber。不得把小题号误当成大题号，也不得重复输出相邻上下文页的题目。",
    "3. 一道大题若包含多个独立得分小问，按可独立作答的小问拆分并填写 partNumber；共享的实验背景、材料、图表说明需复制到相关小题题干中。每条 title 只放该小问，不要把连续多问合成一个题干。",
    "4. 保留题干、选项、化学式、反应条件、数值、单位及选项原文。复杂化学式、方程式和结构图优先用 figures 对应原图裁图。无法读清的内容用【需核对原图】标出，不要臆造。",
    "5. 单选 type 为 single，多选为 multiple，判断题为 judge；填空、计算、简答、实验题为 subjective。选项用 A、B、C 等；选择题 answer 用字母或多选逗号分隔，判断题 answer 用正确或错误，主观题 answer 用完整字符串。若选项是图标、结构式或其他不能转成文字的图形，也必须列出每个选项 key，content 写‘图示选项（见配图）’，并用对应 option:A、option:B 等 figures 裁出选项图。所有题目必须有非空 answer 和有效题干。",
    "6. 只输出有效 JSON；字符串中的特殊字符必须转义，不得添加注释或尾随逗号。",
    `7. 输出本批学生版 ${pageRange} 中实际印出的所有可独立作答小问；即使大题号在前页，也要用其原大题号和本小问 partNumber 输出。相邻上下文页的文字和图片可用于补全本批小问，但不得据此新增上下文页上的小问。sourcePage 必须是本条小问实际所在的学生版页码。`,
    "8. 解析简洁忠实答案版；没有明确解析时留空。",
    "9. 必须查看附带页面图片：题干或选项中出现结构式、反应式、装置图、曲线、表格等非普通文字内容时，在该题 figures 中返回对应图块；答案/解析中的图块 role 用 explanation。普通文字不裁图。",
    "10. 图块必须引用附带图片的 edition 和真实 page；box 为相对整页的 [x,y,width,height]，每项范围 0-1000，使用左上角为原点。只紧贴相关结构式/流程图/曲线裁图并留少量边距，不得用整页或整栏代替小图；同一共享图可被多个小题引用。role 为 title、option:A（替换 A 为选项字母）或 explanation。没有图块时 figures 输出空数组。",
    `11. 只能引用这些页面图片：${imagePages.map(({ edition, pageNumber }) => `${edition}第${pageNumber}页`).join("、")}。`,
    focusQuestionNumber === null
      ? ""
      : `12. 只输出主要题号为 ${focusQuestionNumber} 的题目及其可独立作答小问，不要输出本页其他题目。`,
    focusPartNumber === null || focusPartNumber === undefined
      ? ""
      : focusPartNumber
        ? `12a. 本次只重识别第 ${focusQuestionNumber} 题的第 (${focusPartNumber}) 小问；只输出这一小问，必须仔细核对答案版对应答案，不能使用“需核对原图”代替。`
        : `12a. 本次只重识别第 ${focusQuestionNumber} 题没有括号小问号的主问题；只输出这一题，必须仔细核对答案版对应答案，不能使用“需核对原图”代替。`,
    concise
      ? "13. 输出紧凑 JSON，不要 Markdown；解析尽量简短，若无必要的解析则留空；保留完整题干、选项、答案和必要图块。"
      : "",
    `以下是 ${exam.region} 卷材料。`,
    contextPages.length
      ? `===== 学生版相邻上下文（仅补全题干，不从中提取新题） =====\n${contextPages.map(({ pageNumber, text }) => `【PDF第${pageNumber}页·上下文】\n${text}`).join("\n\n")}`
      : "",
    "===== 学生版 PDF =====",
    formatEdition("学生", exam.editions.student, targetPageNumbers),
    "===== 答案版 PDF =====",
    formatEdition("答案", exam.editions.answer, new Set(answerPages.map(({ pageNumber }) => pageNumber))),
  ].join("\n\n");
}

function extractJsonText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const objectStart = candidate.indexOf("{");
  const arrayStart = candidate.indexOf("[");
  const start = objectStart < 0
    ? arrayStart
    : arrayStart < 0
      ? objectStart
      : Math.min(objectStart, arrayStart);
  if (start < 0) throw new Error("模型没有返回 JSON 对象");

  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const opening = stack.pop();
      if ((character === "}" && opening !== "{") || (character === "]" && opening !== "[")) {
        throw new Error("模型返回的 JSON 括号不匹配");
      }
      if (!stack.length) return candidate.slice(start, index + 1);
    }
  }
  throw new Error("模型返回的 JSON 对象不完整");
}

function repairJsonText(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        if (`"\\/bfnrt`.includes(character)) {
          result += character;
        } else if (character === "u" && /^[\da-f]{4}$/i.test(text.slice(index + 1, index + 5))) {
          result += `u${text.slice(index + 1, index + 5)}`;
          index += 4;
        } else {
          result += `\\${character}`;
        }
        escaped = false;
        continue;
      }
      if (character === "\\") {
        result += character;
        escaped = true;
      } else if (character === '"') {
        let nextIndex = index + 1;
        while (nextIndex < text.length && /\s/.test(text[nextIndex])) nextIndex += 1;
        if (nextIndex === text.length || [",", ":", "}", "]"].includes(text[nextIndex])) {
          result += character;
          inString = false;
        } else {
          result += '\\"';
        }
      } else if (character === "\n") result += "\\n";
      else if (character === "\r") result += "\\r";
      else if (character === "\t") result += "\\t";
      else result += character;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === ",") {
      let nextIndex = index + 1;
      while (nextIndex < text.length && /\s/.test(text[nextIndex])) nextIndex += 1;
      if (![ "}", "]" ].includes(text[nextIndex])) result += character;
      else index = nextIndex - 1;
    } else result += character;
  }
  return result;
}

function parseModelJson(text) {
  const candidate = extractJsonText(text);
  try {
    return JSON.parse(candidate);
  } catch (originalError) {
    try {
      return JSON.parse(repairJsonText(candidate));
    } catch {
      throw new Error(`模型 JSON 格式错误，无法自动修复：${originalError.message}`, {
        cause: originalError,
      });
    }
  }
}

function sourceQuestionsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.questions)) return payload.questions;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.题目)) return payload.题目;
  if (Array.isArray(payload?.data?.questions)) return payload.data.questions;
  if (Array.isArray(payload?.result?.questions)) return payload.result.questions;
  if (typeof payload?.title === "string" || typeof payload?.stem === "string") return [payload];
  return null;
}

function normalizeQuestions(payload, region, targetPages = []) {
  const sourceQuestions = sourceQuestionsFromPayload(payload);
  if (!sourceQuestions) {
    const keys = payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload).slice(0, 8).join("、")
      : typeof payload;
    throw new Error(`AI JSON 中缺少 questions 数组（返回内容类型/顶层键：${keys || "空对象"}）`);
  }
  const questions = sourceQuestions.map((raw, index) => {
    const title = String(raw?.title ?? raw?.stem ?? "").trim();
    if (!title) throw new Error(`第 ${index + 1} 道题缺少题干`);
    const type = ["single", "multiple", "judge", "subjective"].includes(raw.type) ? raw.type : "";
    if (!type) throw new Error(`第 ${index + 1} 道题的题型无效：${raw.type || "空"}`);
    const paperNumber = String(raw.paperNumber ?? raw.questionNumber ?? "").trim();
    const circledNumbers = "①②③④⑤⑥⑦⑧⑨⑩";
    const partNumber = String(raw.partNumber ?? "").normalize("NFKC").trim().replace(/[()（）]/g, "")
      .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (mark) => String(circledNumbers.indexOf(mark) + 1))
      .replace(/[.．_]/g, "-");
    if (!/^\d{1,3}$/.test(paperNumber)) {
      throw new Error(`第 ${index + 1} 道题缺少有效的大题号 paperNumber`);
    }
    if (partNumber && !/^[\da-zA-Z一二三四五六七八九十]+(?:-[\da-zA-Z一二三四五六七八九十]+)*$/.test(partNumber)) {
      throw new Error(`第 ${index + 1} 道题的小题号无效：${partNumber}`);
    }
    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    const optionFigureKeys = [...new Set((Array.isArray(raw.figures) ? raw.figures : [])
      .map((figure) => String(figure?.role || "").match(/^option:([A-F])$/i)?.[1]?.toUpperCase())
      .filter(Boolean))];
    const options = rawOptions.map((option, optionIndex) => ({
      key: String(option?.key || String.fromCharCode(65 + optionIndex)).trim(),
      content: String(option?.content ?? option?.text ?? "").trim(),
    })).filter((option) => option.content);
    for (const key of optionFigureKeys) {
      if (!options.some((option) => option.key.toUpperCase() === key)) {
        options.push({ key, content: "图示选项（见配图）" });
      }
    }
    let answer = Array.isArray(raw.answer) ? raw.answer.join(",") : String(raw.answer ?? "").trim();
    if (type === "subjective" && Array.isArray(raw.answer)) answer = raw.answer.map(String).join("\n").trim();
    if (!answer) throw new Error(`第 ${index + 1} 道题（${paperNumber}${partNumber ? `(${partNumber})` : ""}）缺少参考答案`);
    if (type !== "subjective" && type !== "judge" && !options.length) {
      throw new IncompleteQuestionError(paperNumber, partNumber);
    }
    if (type === "judge") {
      if (/^(a|t|true|对|√)$/i.test(answer)) answer = "正确";
      if (/^(b|f|false|错|×)$/i.test(answer)) answer = "错误";
    }
    const sourcePage = Number(raw.sourcePage);
    if (!Number.isInteger(sourcePage) || sourcePage < 1
      || (targetPages.length && !targetPages.some((page) => page.pageNumber === sourcePage))) {
      throw new Error(`第 ${index + 1} 道题（${paperNumber}${partNumber ? `(${partNumber})` : ""}）的 sourcePage 缺失或不属于本批学生版页面`);
    }
    return {
      id: "",
      type,
      paperNumber,
      partNumber,
      questionLabel: partNumber ? `${paperNumber}(${partNumber})` : paperNumber,
      title,
      sourcePage,
      reviewed: false,
      options,
      answer,
      explanation: String(raw.explanation ?? "").trim(),
      images: [],
    };
  });
  return questions;
}

function validateQuestionBank(exam, questions) {
  const expectedNumbers = [...new Set(
    studentQuestionPages(exam).flatMap(({ text }) => questionNumbersFromText(text)),
  )].sort((a, b) => Number(a) - Number(b));
  const seen = new Set();
  const duplicates = [];
  for (const question of questions) {
    const key = `${question.paperNumber}:${question.partNumber || "main"}`;
    if (seen.has(key)) duplicates.push(question.questionLabel);
    seen.add(key);
  }
  const actualNumbers = new Set(questions.map((question) => question.paperNumber));
  const missingNumbers = expectedNumbers.filter((number) => !actualNumbers.has(number));
  const unexpectedNumbers = [...actualNumbers].filter((number) => !expectedNumbers.includes(number));
  const problems = [];
  if (!questions.length) problems.push("没有识别到题目");
  if (duplicates.length) problems.push(`题号重复：${[...new Set(duplicates)].join("、")}`);
  if (missingNumbers.length) problems.push(`缺少卷面题号：${missingNumbers.join("、")}`);
  if (unexpectedNumbers.length) problems.push(`出现原卷中不存在的题号：${unexpectedNumbers.join("、")}`);
  const invalidQuestions = questions.filter(questionHasIntegrityIssue);
  if (invalidQuestions.length) problems.push(`有 ${invalidQuestions.length} 道题缺少必需字段、答案或仍含待核对标记`);
  return {
    valid: problems.length === 0,
    expectedNumbers,
    coveredNumbers: [...actualNumbers].sort((a, b) => Number(a) - Number(b)),
    questionCount: questions.length,
    duplicateLabels: [...new Set(duplicates)],
    missingNumbers,
    unexpectedNumbers,
    problems,
  };
}

function questionHasIntegrityIssue(question) {
  const needsReview = /需核对原图|答案未提供|需人工补录|待补充|待核对/i;
  return !question.title.trim() || !question.answer.trim()
    || needsReview.test(question.title) || needsReview.test(question.answer)
    || question.options.some((option) => option.content.includes("图示选项（见配图）")
      && !option.formulaImages?.length)
    || (question.type !== "subjective" && question.type !== "judge" && !question.options.length)
    || (question.type === "single" && !question.options.some((option) =>
      option.key.toUpperCase() === question.answer.toUpperCase(),
    ))
    || (question.type === "multiple" && multipleAnswerKeys(question.answer).some((key) =>
      !question.options.some((option) => option.key.toUpperCase() === key.toUpperCase()),
    ))
    || (question.type === "judge" && !/^(正确|错误)$/.test(question.answer));
}

function multipleAnswerKeys(answer) {
  const text = String(answer || "").trim().toUpperCase();
  const delimited = text.split(/[,，、\s/|]+/).filter(Boolean);
  return delimited.length === 1 && /^[A-F]{2,}$/.test(delimited[0])
    ? [...delimited[0]]
    : delimited;
}

function answerTextByQuestion(exam) {
  const answers = new Map();
  const markerPattern = /(?:^|\s)(\d{1,2})\s*[.．、)]\s*(?:【\s*答案\s*】|答案\s*[:：])\s*/g;
  for (const page of exam.editions.answer.flatMap((edition) => edition.pages)) {
    const markers = [...page.text.matchAll(markerPattern)];
    markers.forEach((marker, index) => {
      const start = marker.index + marker[0].length;
      const nextQuestion = markers[index + 1]?.index ?? page.text.length;
      const explanation = page.text.indexOf("【解析】", start);
      const end = explanation >= 0 && explanation < nextQuestion ? explanation : nextQuestion;
      const segments = answers.get(marker[1]) || [];
      segments.push(page.text.slice(start, end).trim());
      answers.set(marker[1], segments);
    });
  }
  return answers;
}

function answerForQuestionFromPdf(question, answersByQuestion) {
  const segments = answersByQuestion.get(question.paperNumber) || [];
  for (const segment of segments) {
    if (question.type === "single" || question.type === "multiple") {
      const match = segment.match(/^\s*[（(]?\s*([A-F]{1,6})\s*[）)]?(?=\s|$|[【.．、])/i);
      if (match) return match[1].toUpperCase().split("").join(",");
      continue;
    }
    if (question.type === "judge") {
      const match = segment.match(/^\s*(正确|错误|对|错)(?=\s|$|[，。])/);
      if (match) return /^(正确|对)$/.test(match[1]) ? "正确" : "错误";
      continue;
    }
    if (!/^\d+$/.test(question.partNumber || "")) continue;
    const partPattern = /(?:^|\s)[（(]\s*(\d+)\s*[）)]\s*/g;
    const parts = [...segment.matchAll(partPattern)];
    const partIndex = parts.findIndex((part) => part[1] === question.partNumber);
    if (partIndex < 0) continue;
    const start = parts[partIndex].index + parts[partIndex][0].length;
    const end = parts[partIndex + 1]?.index ?? segment.length;
    const answer = segment.slice(start, end).trim().replace(/^[：:、，,。\s]+|[、，,。\s]+$/g, "");
    const meaningful = answer.replace(/[^\p{L}\p{N}]/gu, "");
    if (!answer || !meaningful || /^(?:任写一种|略|见图|如图)$/u.test(answer)) continue;
    if (answer.includes("任写一种") && !answer.replace("任写一种", "").replace(/[^\p{L}\p{N}]/gu, "")) continue;
    if (/[=＝→⇌]/.test(answer) && /^[+＋=＝\s]/.test(answer)) continue;
    return answer;
  }
  return "";
}

function titleSimilarity(left, right) {
  const canonical = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const a = canonical(left);
  const b = canonical(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const bigrams = (text) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)));
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  const overlap = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return overlap / Math.max(1, new Set([...leftPairs, ...rightPairs]).size);
}

function removeRepeatedQuestions(questions) {
  const kept = [];
  const duplicateKeys = new Set();
  for (const question of questions) {
    const key = `${question.paperNumber}:${question.partNumber || "main"}`;
    const duplicate = kept.find((candidate) =>
      `${candidate.paperNumber}:${candidate.partNumber || "main"}` === key
      && titleSimilarity(candidate.title, question.title) >= 0.75,
    );
    if (duplicate) {
      duplicateKeys.add(key);
      if (question.explanation && !duplicate.explanation) duplicate.explanation = question.explanation;
      duplicate.images ||= [];
      duplicate.images.push(...(question.images || []));
      duplicate.titleImages ||= [];
      duplicate.titleImages.push(...(question.titleImages || []));
      duplicate.explanationImages ||= [];
      duplicate.explanationImages.push(...(question.explanationImages || []));
    } else kept.push(question);
  }
  if (duplicateKeys.size) console.warn(`  合并跨页重复识别题目：${[...duplicateKeys].join("、")}`);
  return kept;
}

function cropFigure(pageCanvas, box) {
  const values = Array.isArray(box)
    ? box.map(Number)
    : [box?.x, box?.y, box?.width, box?.height].map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  let [x, y, width, height] = values;
  if (values.every((value) => value >= 0 && value <= 1)) {
    [x, y, width, height] = values.map((value) => value * 1000);
  }
  const scaleX = pageCanvas.width / 1000;
  const scaleY = pageCanvas.height / 1000;
  const paddingX = Math.max(6, Math.round(scaleX * 12));
  const paddingY = Math.max(6, Math.round(scaleY * 12));
  const left = Math.max(0, Math.floor(x * scaleX) - paddingX);
  const top = Math.max(0, Math.floor(y * scaleY) - paddingY);
  const right = Math.min(pageCanvas.width, Math.ceil((x + width) * scaleX) + paddingX);
  const bottom = Math.min(pageCanvas.height, Math.ceil((y + height) * scaleY) + paddingY);
  if (right - left < 12 || bottom - top < 12) return null;
  const crop = createCanvas(right - left, bottom - top);
  crop.getContext("2d").drawImage(pageCanvas, left, top, right - left, bottom - top, 0, 0, crop.width, crop.height);
  return crop.toDataURL("image/png");
}

function attachFigureCrops(questions, payload, renderedPages) {
  const pageMap = new Map(renderedPages.map((page) => [`${page.edition}:${page.pageNumber}`, page]));
  const sourceQuestions = sourceQuestionsFromPayload(payload) || [];
  let cropCount = 0;
  questions.forEach((question, index) => {
    const figures = Array.isArray(sourceQuestions[index]?.figures) ? sourceQuestions[index].figures : [];
    for (const [figureIndex, figure] of figures.entries()) {
      const sourcePage = pageMap.get(`${figure?.edition}:${Number(figure?.page)}`);
      if (!sourcePage) {
        console.warn(
          `  ${questions[index].id || "题目"}：AI 引用的 ${figure?.edition} 第 ${figure?.page} 页图片未随本次请求发送，已忽略该图块。`,
        );
        continue;
      }
      const dataUrl = cropFigure(sourcePage.canvas, figure.box);
      if (!dataUrl) {
        throw new Error(`第 ${index + 1} 道题的第 ${figureIndex + 1} 个图片区域无效，无法裁剪`);
      }
      const image = { page: sourcePage.pageNumber, dataUrl };
      cropCount += 1;
      if (figure.role === "title") {
        question.titleImages ||= [];
        question.titleImages.push(image);
      } else if (figure.role === "explanation") {
        question.explanationImages ||= [];
        question.explanationImages.push(image);
      } else {
        const optionKey = String(figure.role || "").match(/^option:([A-F])$/i)?.[1]?.toUpperCase();
        const option = question.options.find((item) => item.key.toUpperCase() === optionKey);
        if (option) {
          option.formulaImages ||= [];
          option.formulaImages.push(image);
        } else {
          question.images ||= [];
          question.images.push(image);
        }
      }
    }
  });
  return cropCount;
}

async function applyVerifiedPdfCorrections(exam, questions) {
  const corrections = VERIFIED_PDF_CORRECTIONS[exam.region];
  if (!corrections) return;
  const answerPageReferences = exam.editions.answer.flatMap(({ pages }) => pages);
  let applied = 0;
  for (const [key, correction] of Object.entries(corrections)) {
    const [paperNumber, partNumber] = key.split(":");
    const question = questions.find((item) => item.paperNumber === paperNumber && item.partNumber === partNumber);
    if (!question) continue;
    question.answer = correction.answer;
    if (correction.page && correction.box) {
      const sourcePage = answerPageReferences.find((page) => page.pageNumber === correction.page);
      if (!sourcePage) continue;
      const rendered = await renderPdfPage({ ...sourcePage, edition: "answer" });
      const dataUrl = cropFigure(rendered.canvas, correction.box);
      if (!dataUrl) throw new Error(`人工核对的答案图裁切无效：${exam.region} 第 ${key} 题`);
      question.explanationImages = [{ page: correction.page, dataUrl }];
    }
    applied += 1;
  }
  if (applied) console.log(`  ${exam.region}：已应用 ${applied} 条对照原卷核实的答案/配图修正。`);
}

async function requestQuestions(
  exam,
  settings,
  targetPages,
  contextPages,
  {
    includeAnswerPages = true,
    focusQuestionNumber = null,
    focusPartNumber = null,
    concise = false,
    includeContextImages = false,
  } = {},
) {
  const answerPages = includeAnswerPages ? findRelevantAnswerPages(exam, targetPages) : [];
  const pageReferences = [
    ...targetPages.map((page) => ({ ...page, edition: "student" })),
    ...(includeContextImages ? contextPages.map((page) => ({ ...page, edition: "student" })) : []),
    ...answerPages.map((page) => ({ ...page, edition: "answer" })),
  ].filter((page, index, pages) => pages.findIndex((candidate) =>
    candidate.edition === page.edition && candidate.pageNumber === page.pageNumber
      && candidate.pdfPath === page.pdfPath,
  ) === index);
  const renderedPages = await Promise.all(pageReferences.map(renderPdfPage));
  const baseUrl = settings.baseUrl.replace(/\/+$/, "");
  const endpoint = /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const prompt = promptForExam(exam, targetPages, contextPages, answerPages, renderedPages, {
    focusQuestionNumber,
    focusPartNumber,
    concise,
  });
  const messageContent = [
    { type: "text", text: prompt },
    ...renderedPages.flatMap((page) => [
      { type: "text", text: `以下附图为 ${page.edition}版 PDF 第 ${page.pageNumber} 页。` },
      { type: "image_url", image_url: { url: page.dataUrl } },
    ]),
  ];
  const response = await postWithRetry(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      reasoning_effort: "low",
      messages: [{ role: "user", content: messageContent }],
    }),
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`接口返回非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const apiMessage = body?.error?.message || body?.message || "未知错误";
    if (/inputs.*tokens.*max_new_tokens.*16384|context.{0,30}(length|limit)|input.{0,20}too long/i.test(apiMessage)) {
      throw new InputTokenLimitError(
        `学生版第 ${targetPages[0].pageNumber} 页的输入超出模型上下文上限`,
      );
    }
    throw new Error(`AI 接口返回 HTTP ${response.status}：${apiMessage}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI 接口没有返回文本内容");
  }
  if (body?.choices?.[0]?.finish_reason === "length") {
    const pageRange = targetPages.length === 1
      ? `第 ${targetPages[0].pageNumber} 页`
      : `第 ${targetPages[0].pageNumber}-${targetPages.at(-1).pageNumber} 页`;
    throw new OutputTokenLimitError(
      `学生版${pageRange}的 AI 输出达到 ${MAX_OUTPUT_TOKENS} tokens 上限`,
    );
  }
  let payload;
  try {
    payload = parseModelJson(content);
  } catch (error) {
    throw new Error(`AI 返回内容无法解析为 JSON：${error.message}`);
  }
  const questions = normalizeQuestions(payload, exam.region, targetPages);
  const cropCount = attachFigureCrops(questions, payload, renderedPages);
  console.log(`  ${exam.region}：本批保留 ${cropCount} 个题干/选项/答案图块`);
  return questions;
}

async function postWithRetry(endpoint, options) {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const delays = [2_000, 5_000, 10_000];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchWithDiagnostics(endpoint, {
      ...options,
      signal: AbortSignal.timeout(180_000),
    });
    if (!retryableStatuses.has(response.status) || attempt >= delays.length) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : delays[attempt];
    console.warn(`  Gemini 暂时返回 HTTP ${response.status}，${Math.ceil(delay / 1000)} 秒后重试（${attempt + 1}/${delays.length}）。`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function fetchWithDiagnostics(endpoint, options) {
  try {
    return await fetch(endpoint, options);
  } catch (error) {
    const networkDetails = [
      error?.cause?.code,
      error?.cause?.message,
      ...(Array.isArray(error?.cause?.errors)
        ? error.cause.errors.map((item) => `${item?.code || ""} ${item?.message || ""}`.trim())
        : []),
    ].filter(Boolean).join("; ");
    throw new Error(
      `无法连接 AI 接口${networkDetails ? `（${networkDetails}）` : ""}。请检查网络、HTTPS 代理与 TLS 设置；确认当前终端可访问 open.bigmodel.cn:443 后重试`,
      { cause: error },
    );
  }
}

async function requestExamQuestions(exam, settings, progressPath) {
  const studentPages = studentQuestionPages(exam);
  if (!studentPages.length) throw new Error("没有学生版页面可处理");

  const fingerprintForVersion = (converterVersion) => createHash("sha256")
    .update(JSON.stringify({
      converterVersion,
      student: exam.editions.student.map((edition) => edition.hash),
      answer: exam.editions.answer.map((edition) => edition.hash),
    }))
    .digest("hex");
  const sourceFingerprint = fingerprintForVersion(CONVERTER_VERSION);
  const compatibleFingerprints = new Set([
    CONVERTER_VERSION,
    "2026-10-22",
    "2026-10-21",
    "2026-10-20",
    "2026-10-19",
    "2026-10-18",
    "2026-10-10",
    "2026-10-9",
    "2026-10-8",
    "2026-10-7",
    "2026-10-6",
    "2026-10-5",
    "2026-10-3",
    "2026-10-2",
    "2026-10-4",
  ].map(fingerprintForVersion));
  let questions = [];
  let completedPages = 0;
  let attemptedRepairs = new Set();
  const repairSettings = process.env.AI_REPAIR_MODEL
    ? { ...settings, model: process.env.AI_REPAIR_MODEL }
    : settings;
  if (progressPath) {
    try {
      const progress = JSON.parse(await readFile(progressPath, "utf8"));
      if (compatibleFingerprints.has(progress.sourceFingerprint)
        && progress.model === settings.model
        && Number.isInteger(progress.completedPages)
        && progress.completedPages > 0
        && progress.completedPages <= studentPages.length
        && Array.isArray(progress.questions)) {
        questions = progress.questions;
        completedPages = progress.completedPages;
        attemptedRepairs = progress.repairVersion === CONVERTER_VERSION
          ? new Set(Array.isArray(progress.attemptedRepairs) ? progress.attemptedRepairs : [])
          : new Set();
        console.log(`  ${exam.region}：从进度文件恢复，跳过前 ${completedPages} 页和 ${questions.length} 道已保存题目。`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`  ${exam.region}：进度文件无法读取，将从头处理。`);
    }
  }

  async function saveProgress(nextCompletedPages) {
    if (!progressPath) return;
    questions.forEach((question, index) => {
      question.id = `${exam.region}-${index + 1}`;
    });
    const temporaryPath = `${progressPath}.tmp`;
    const progress = {
      sourceFingerprint,
      model: settings.model,
      repairVersion: CONVERTER_VERSION,
      completedPages: nextCompletedPages,
      attemptedRepairs: [...attemptedRepairs],
      questions,
    };
    await writeFile(temporaryPath, `${JSON.stringify(progress)}\n`, "utf8");
    await rename(temporaryPath, progressPath);
  }

  async function requestBatch(targetPages) {
    const firstPageIndex = studentPages.indexOf(targetPages[0]);
    const lastPageIndex = firstPageIndex + targetPages.length - 1;
    const contextPages = [studentPages[firstPageIndex - 1], studentPages[lastPageIndex + 1]].filter(Boolean);
    const pageRange = targetPages.length === 1
      ? `第 ${targetPages[0].pageNumber} 页`
      : `第 ${targetPages[0].pageNumber}-${targetPages.at(-1).pageNumber} 页`;
    console.log(`  ${exam.region}：识别学生版${pageRange}`);
    try {
      return await requestQuestions(exam, settings, targetPages, contextPages);
    } catch (error) {
      if (/AI 返回内容无法解析为 JSON/.test(error.message || "")) {
        let parseError = error;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          console.warn(`  ${exam.region}：${pageRange} 的模型 JSON 格式无效，重新请求（${attempt}/2）。`);
          try {
            return await requestQuestions(exam, settings, targetPages, contextPages, { concise: true });
          } catch (retryError) {
            if (!/AI 返回内容无法解析为 JSON/.test(retryError.message || "")) throw retryError;
            parseError = retryError;
          }
        }
        throw parseError;
      }
      if (error instanceof IncompleteQuestionError) {
        let lastError = error;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          console.warn(`  ${exam.region}：${pageRange} 的第 ${error.paperNumber} 题选项不完整，连同相邻页图片定向重识别（${attempt}/2）。`);
          try {
            return await requestQuestions(exam, settings, targetPages, contextPages, {
              focusQuestionNumber: error.paperNumber,
              concise: true,
              includeContextImages: true,
            });
          } catch (retryError) {
            if (!(retryError instanceof IncompleteQuestionError)) throw retryError;
            lastError = retryError;
          }
        }
        throw lastError;
      }
      if (error instanceof InputTokenLimitError) {
        if (contextPages.length) {
          console.warn(`  ${exam.region}：${pageRange} 输入超过上下文上限，先去除相邻上下文并保留答案页重试。`);
          try {
            return await requestQuestions(exam, settings, targetPages, []);
          } catch (retryError) {
            if (!(retryError instanceof InputTokenLimitError)) throw retryError;
            if (!findRelevantAnswerPages(exam, targetPages).length) {
              throw new Error(`${retryError.message}；请改用更大上下文的视觉模型`);
            }
            console.warn(`  ${exam.region}：${pageRange} 仍超过上下文上限，去除答案页后重试。`);
            return requestQuestions(exam, settings, targetPages, [], { includeAnswerPages: false });
          }
        }
        if (findRelevantAnswerPages(exam, targetPages).length) {
          console.warn(`  ${exam.region}：${pageRange} 输入超过上下文上限，去除答案页后重试。`);
          return requestQuestions(exam, settings, targetPages, [], { includeAnswerPages: false });
        }
        throw new Error(`${error.message}；请改用更大上下文的视觉模型`);
      }
      if (error instanceof OutputTokenLimitError && targetPages.length === 1) {
        const questionNumbers = [
          ...questionNumbersFromText(targetPages[0].text),
        ];
        const focusedQuestions = [];
        for (const questionNumber of questionNumbers.length ? questionNumbers : [null]) {
          try {
            const focused = await requestQuestions(exam, settings, targetPages, [], {
              focusQuestionNumber: questionNumber,
              concise: true,
            });
            if (questionNumber !== null && focused.length === 0) {
              throw new Error(`AI 未能识别题号 ${questionNumber}`);
            }
            focusedQuestions.push(...focused);
          } catch (retryError) {
            if (retryError instanceof OutputTokenLimitError) {
              throw new Error(
                `${pageRange}${questionNumber === null ? "" : `的第 ${questionNumber} 题`}仍超过 ${MAX_OUTPUT_TOKENS} tokens；未保存不完整题库`,
              );
            }
            throw retryError;
          }
        }
        console.log(`  ${exam.region}：按题号拆分识别 ${focusedQuestions.length} 道题`);
        return focusedQuestions;
      }
      if (!(error instanceof OutputTokenLimitError)) throw error;
      const middle = Math.ceil(targetPages.length / 2);
      console.warn(`  ${exam.region}：${pageRange} 输出过长，自动拆成更小批次重试。`);
      const left = await requestBatch(targetPages.slice(0, middle));
      const right = await requestBatch(targetPages.slice(middle));
      return [...left, ...right];
    }
  }

  for (let index = completedPages; index < studentPages.length; index += STUDENT_PAGES_PER_REQUEST) {
    const targetPages = studentPages.slice(index, index + STUDENT_PAGES_PER_REQUEST);
    const batch = await requestBatch(targetPages);
    questions.push(...batch);
    await saveProgress(index + targetPages.length);
  }

  if (!questions.length) throw new Error("AI 没有生成任何题目");
  const answersByQuestion = answerTextByQuestion(exam);
  let restoredAnswers = 0;
  for (const question of questions) {
    const extractedAnswer = answerForQuestionFromPdf(question, answersByQuestion);
    if (extractedAnswer && (question.type === "single" || question.type === "multiple"
      || question.type === "judge" || !question.answer.trim()
      || /需核对原图|答案未提供|需人工补录|待补充|待核对/i.test(question.answer))) {
      if (question.answer !== extractedAnswer) {
        question.answer = extractedAnswer;
        restoredAnswers += 1;
      }
    }
  }
  if (restoredAnswers) {
    console.log(`  ${exam.region}：从答案版 PDF 可提取文本恢复 ${restoredAnswers} 个答案。`);
    await saveProgress(studentPages.length);
  }
  const currentNumbers = new Set(questions.map((question) => question.paperNumber));
  const expectedNumbers = [...new Set(studentPages.flatMap(({ text }) => questionNumbersFromText(text)))];
  for (const missingNumber of expectedNumbers.filter((number) => !currentNumbers.has(number))) {
    const recoveryKey = `missing:${missingNumber}`;
    if (attemptedRepairs.has(recoveryKey)) continue;
    const candidatePages = studentPages.filter((page) => questionNumbersFromText(page.text).includes(missingNumber));
    for (const page of candidatePages) {
      const pageIndex = studentPages.indexOf(page);
      const contextPages = [studentPages[pageIndex - 1], studentPages[pageIndex + 1]].filter(Boolean);
      console.warn(`  ${exam.region}：完整性检查发现第 ${missingNumber} 题缺失，按题号连同相邻页图片补识别。`);
      try {
        const recovered = await requestQuestions(exam, repairSettings, [page], contextPages, {
          focusQuestionNumber: missingNumber,
          concise: true,
          includeContextImages: true,
        });
        const recoveredForNumber = recovered.filter((question) => question.paperNumber === missingNumber);
        if (recoveredForNumber.length) {
          questions.push(...recoveredForNumber);
          break;
        }
      } catch (error) {
        console.warn(`  ${exam.region}：第 ${missingNumber} 题补识别失败：${error.message}`);
      }
    }
    attemptedRepairs.add(recoveryKey);
    await saveProgress(studentPages.length);
  }
  const issuePaperNumbers = new Set(
    questions.filter(questionHasIntegrityIssue).map((question) => question.paperNumber),
  );
  const labelCounts = new Map();
  questions.forEach((question) => {
    const key = `${question.paperNumber}:${question.partNumber || "main"}`;
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  });
  for (const [key, count] of labelCounts) {
    if (count > 1) issuePaperNumbers.add(key.split(":", 1)[0]);
  }

  for (const paperNumber of issuePaperNumbers) {
    if (attemptedRepairs.has(paperNumber)) continue;
    const currentGroup = questions.filter((question) => question.paperNumber === paperNumber);
    const sourcePageNumbers = [...new Set(currentGroup.map((question) => question.sourcePage))];
    const pageIndexes = sourcePageNumbers
      .map((pageNumber) => studentPages.findIndex((page) => page.pageNumber === pageNumber))
      .filter((index) => index >= 0);
    if (!pageIndexes.length) continue;
    const firstIndex = Math.min(...pageIndexes);
    const lastIndex = Math.max(...pageIndexes);
    const targetPages = studentPages.slice(firstIndex, lastIndex + 1);
    const contextPages = [studentPages[firstIndex - 1], studentPages[lastIndex + 1]].filter(Boolean);
    console.warn(`  ${exam.region}：第 ${paperNumber} 题存在缺答案或重复小问号，整题连同相关答案页重识别。`);
    try {
      const recovered = (await requestQuestions(exam, repairSettings, targetPages, contextPages, {
        focusQuestionNumber: paperNumber,
        concise: true,
        includeContextImages: true,
      })).filter((question) => question.paperNumber === paperNumber);
      const recoveredLabels = recovered.map((question) => `${question.paperNumber}:${question.partNumber || "main"}`);
      const oldUniqueLabels = new Set(currentGroup.map((question) => `${question.paperNumber}:${question.partNumber || "main"}`));
      const recoveredHasDuplicate = new Set(recoveredLabels).size !== recoveredLabels.length;
      if (recovered.length >= oldUniqueLabels.size
        && !recoveredHasDuplicate
        && recovered.every((question) => !questionHasIntegrityIssue(question))) {
        questions = questions.filter((question) => question.paperNumber !== paperNumber).concat(recovered);
        console.log(`  ${exam.region}：第 ${paperNumber} 题重识别通过，更新 ${recovered.length} 个小问。`);
      } else {
        const recoveredCounts = new Map();
        recoveredLabels.forEach((key) => recoveredCounts.set(key, (recoveredCounts.get(key) || 0) + 1));
        const validUpdates = recovered.filter((question) => {
          const key = `${question.paperNumber}:${question.partNumber || "main"}`;
          return oldUniqueLabels.has(key) && recoveredCounts.get(key) === 1 && !questionHasIntegrityIssue(question);
        });
        const updateLabels = new Set(validUpdates.map((question) => `${question.paperNumber}:${question.partNumber || "main"}`));
        if (updateLabels.size) {
          questions = questions.filter((question) => question.paperNumber !== paperNumber
            || !updateLabels.has(`${question.paperNumber}:${question.partNumber || "main"}`)).concat(validUpdates);
          console.log(`  ${exam.region}：第 ${paperNumber} 题部分重识别通过，更新 ${updateLabels.size} 个小问；其余保留原结果。`);
        } else {
          console.warn(`  ${exam.region}：第 ${paperNumber} 题重识别仍有缺项，保留原结果并标记失败。`);
        }
      }
    } catch (error) {
      console.warn(`  ${exam.region}：第 ${paperNumber} 题定向重识别失败：${error.message}`);
    }
    attemptedRepairs.add(paperNumber);
    await saveProgress(studentPages.length);
  }
  const unresolvedQuestions = [...new Map(
    questions.filter(questionHasIntegrityIssue)
      .map((question) => [`${question.paperNumber}:${question.partNumber || "main"}`, question]),
  ).values()];
  for (const question of unresolvedQuestions) {
    const label = `${question.paperNumber}:${question.partNumber || "main"}`;
    const repairKey = `part:${label}`;
    if (attemptedRepairs.has(repairKey)) continue;
    const pageIndex = studentPages.findIndex((page) => page.pageNumber === question.sourcePage);
    if (pageIndex < 0) continue;
    const targetPage = studentPages[pageIndex];
    const contextPages = [studentPages[pageIndex - 1], studentPages[pageIndex + 1]].filter(Boolean);
    console.warn(`  ${exam.region}：第 ${question.questionLabel} 小问仍不完整，按小问单独重识别。`);
    try {
      const recovered = await requestQuestions(exam, repairSettings, [targetPage], contextPages, {
        focusQuestionNumber: question.paperNumber,
        focusPartNumber: question.partNumber || "",
        concise: true,
        includeContextImages: true,
      });
      const replacement = recovered.find((candidate) => candidate.paperNumber === question.paperNumber
        && candidate.partNumber === question.partNumber
        && !questionHasIntegrityIssue(candidate));
      if (replacement) {
        questions = questions.filter((candidate) =>
          `${candidate.paperNumber}:${candidate.partNumber || "main"}` !== label,
        ).concat(replacement);
        console.log(`  ${exam.region}：第 ${question.questionLabel} 小问补识别通过。`);
      } else {
        console.warn(`  ${exam.region}：第 ${question.questionLabel} 小问单独识别仍未通过完整性校验。`);
      }
    } catch (error) {
      console.warn(`  ${exam.region}：第 ${question.questionLabel} 小问单独识别失败：${error.message}`);
    }
    attemptedRepairs.add(repairKey);
    await saveProgress(studentPages.length);
  }
  await applyVerifiedPdfCorrections(exam, questions);
  questions = removeRepeatedQuestions(questions);
  questions.sort((left, right) =>
    Number(left.paperNumber) - Number(right.paperNumber)
      || String(left.partNumber || "").localeCompare(String(right.partNumber || ""), "zh-CN", { numeric: true })
      || (left.sourcePage || 0) - (right.sourcePage || 0),
  );
  const integrity = validateQuestionBank(exam, questions);
  if (!integrity.valid) {
    throw new Error(`完整性检查未通过，未写出题库：${integrity.problems.join("；")}`);
  }
  questions.forEach((question, index) => {
    question.id = `${exam.region}-${question.paperNumber}-${question.partNumber || "main"}`;
  });
  return { questions, integrity };
}

async function writeBank(outputDirectory, exam, questions, integrity) {
  const outputPath = path.join(outputDirectory, `2026-${exam.region}-化学题库.json`);
  const temporaryPath = `${outputPath}.tmp`;
  const payload = {
    format: "local-question-bank-v1",
    name: `2026年高考化学真题（${exam.region}）`,
    source: "pdf",
    exportedAt: new Date().toISOString(),
    integrity,
    questions,
  };
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return outputPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const unknownRegions = options.regions.filter((region) => !REGIONS.includes(region));
  if (unknownRegions.length) throw new Error(`未知地区：${unknownRegions.join("、")}；可选地区：${REGIONS.join("、")}`);
  const { files, duplicateCount, exams } = await collectExams(options.input, options.regions);
  const orderedExams = [...exams.values()].sort(
    (left, right) => REGIONS.indexOf(left.region) - REGIONS.indexOf(right.region),
  );
  const pages = orderedExams.flatMap((exam) =>
    [...exam.editions.student, ...exam.editions.answer].flatMap((edition) => edition.pages),
  );
  const characterCount = pages.reduce((sum, page) => sum + page.text.length, 0);
  console.log(`找到 ${files.length} 个 PDF；跳过 ${duplicateCount} 个完全重复副本。`);
  console.log(`整理为 ${orderedExams.length} 个地区，${pages.length} 页，提取到 ${characterCount} 个文字字符。`);
  for (const exam of orderedExams) {
    const examPages = [...exam.editions.student, ...exam.editions.answer]
      .reduce((sum, edition) => sum + edition.pages.length, 0);
    const chars = [...exam.editions.student, ...exam.editions.answer]
      .flatMap((edition) => edition.pages)
      .reduce((sum, page) => sum + page.text.length, 0);
    console.log(`  ${exam.region}: 学生版 ${exam.editions.student.length} 份，答案版 ${exam.editions.answer.length} 份；${examPages} 页，${chars} 字符`);
  }
  if (options.dryRun) {
    console.log("试运行结束，没有调用 AI，也没有写出题库。");
    return;
  }

  const settings = {
    apiKey: process.env.VISION_API_KEY || process.env.GEMINI_API_KEY || process.env.ZHIPU_API_KEY || "",
    baseUrl: process.env.AI_API_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.AI_MODEL || DEFAULT_MODEL,
  };
  if (!settings.apiKey) {
    throw new Error("缺少视觉模型 API Key。请设置 VISION_API_KEY 或 GEMINI_API_KEY 环境变量。");
  }

  await mkdir(options.output, { recursive: true });
  let failures = 0;
  for (const exam of orderedExams) {
    const outputPath = path.join(options.output, `2026-${exam.region}-化学题库.json`);
    try {
      if (!options.overwrite) {
        try {
          await readFile(outputPath);
          console.log(`跳过已有题库：${path.basename(outputPath)}（如需重做请加 --overwrite）`);
          continue;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      console.log(`正在处理 ${exam.region}…`);
      const progressPath = `${outputPath}.progress.json`;
      const { questions, integrity } = await requestExamQuestions(exam, settings, progressPath);
      const savedPath = await writeBank(options.output, exam, questions, integrity);
      await unlink(progressPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      console.log(`已保存 ${path.basename(savedPath)}：${questions.length} 道题；题号覆盖 ${integrity.coveredNumbers.join("、")}，完整性检查通过`);
    } catch (error) {
      failures += 1;
      console.error(`处理 ${exam.region} 失败：${error.message || String(error)}`);
    } finally {
      const filePaths = [...exam.editions.student, ...exam.editions.answer]
        .flatMap((edition) => edition.pages.map((page) => page.pdfPath));
      await closeRenderedDocuments(filePaths);
    }
  }
  if (failures) throw new Error(`${failures} 个地区处理失败；已成功保存的 JSON 保留，可修复后重跑继续。`);
  console.log(`全部完成。题库目录：${options.output}`);
}

main().catch((error) => {
  console.error(`转换失败：${error.message || String(error)}`);
  process.exitCode = 1;
});
