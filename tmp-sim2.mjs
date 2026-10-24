// 模拟「按版面 y 带分配图片」的新算法，逐题对比需求与供给
import fs from "node:fs";
import { parseQuestionBank } from "./word-quiz/src/word-parser.js";
import { formulaCount } from "./src/question-text.js";

const xml = fs.readFileSync("tmp-doc.xml", "utf8");
const body = xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("</w:body>"));

const TOKEN = /<w:(p|tbl)\b[^>]*>|<\/w:(p|tbl)>/g;
const blocks = [];
let depth = 0;
let current = null;
let m;
while ((m = TOKEN.exec(body))) {
  const raw = m[0];
  const isClose = raw.charAt(1) === "/";
  const tag = isClose ? m[2] : m[1];
  if (isClose) {
    if (depth > 0) depth -= 1;
    if (depth === 0 && current) {
      current.end = m.index + raw.length;
      blocks.push(current);
      current = null;
    }
  } else if (raw.slice(-2) === "/>") {
    continue;
  } else {
    if (depth === 0 && !current) current = { type: tag, start: m.index };
    depth += 1;
  }
}

const RUN_RE = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
const T_RE = /<(?:[A-Za-z0-9]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?t>/g;
const SPACING_RE = /<w:spacing\b[^>]*?w:val="(-?[0-9.]+)"/;
const PICT_RE = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
const SHAPE_RE = /<v:shape\b[^>]*?style="([^"]*)"/;
const TOKEN_CHAR = "\uE000";

function texts(run) {
  let t = "";
  let tm;
  T_RE.lastIndex = 0;
  while ((tm = T_RE.exec(run))) t += tm[1];
  return t;
}

function paragraphText(content) {
  let out = "";
  let rm;
  RUN_RE.lastIndex = 0;
  while ((rm = RUN_RE.exec(content))) {
    const run = rm[1];
    const sm = run.match(SPACING_RE);
    let isGap = false;
    if (sm) {
      const v = Number(sm[1]);
      if ((v >= 150 && v <= 1100) || v >= 4000) {
        if (!texts(run).trim()) isGap = true;
      }
    }
    out += isGap ? TOKEN_CHAR : texts(run);
  }
  return out.replace(/\u00a0/g, " ").trim();
}

function styleNum(style, prop) {
  const mm = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return mm ? Number(mm[1]) : 0;
}

const paragraphs = [];
const images = [];
blocks.forEach((block, index) => {
  const content = body.slice(block.start, block.end);
  paragraphs.push({ index, text: paragraphText(content) });
  let pm;
  PICT_RE.lastIndex = 0;
  while ((pm = PICT_RE.exec(content))) {
    const style = (pm[1].match(SHAPE_RE) || [])[1] || "";
    const w = styleNum(style, "width");
    const h = styleNum(style, "height");
    if (w < 6 || h < 6) continue;
    images.push({ p: index, w, h, x: styleNum(style, "margin-left"), y: styleNum(style, "margin-top") });
  }
});

// ---------- 版面：每页段落的 y 带 ----------
const CHARS_PER_LINE = 38;
function lineWeight(text) {
  let units = 0;
  let chars = 0;
  for (const ch of text) {
    if (ch === TOKEN_CHAR) {
      units += 4;
      chars += 4;
      continue;
    }
    units += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55;
    chars += 1;
  }
  return Math.max(0.35, Math.ceil(chars ? units / CHARS_PER_LINE : 0.35));
}
const weights = paragraphs.map((p) => lineWeight(p.text));

const PAGE_H = Math.max(600, Math.ceil(Math.max(...images.map((im) => im.y + im.h))));
const anchors = [...new Set(images.map((im) => im.p))].sort((a, b) => a - b);
const pages = anchors.map((anchor, k) => {
  const nextAnchor = k + 1 < anchors.length ? anchors[k + 1] : paragraphs.length;
  let total = 0;
  for (let i = anchor; i < nextAnchor; i += 1) total += weights[i];
  total = total || 1;
  const bands = [];
  let y = 0;
  for (let i = anchor; i < nextAnchor; i += 1) {
    const height = (weights[i] / total) * PAGE_H;
    bands.push({ index: i, top: y, bottom: y + height });
    y += height;
  }
  return {
    anchor,
    nextAnchor,
    bands,
    images: images.filter((im) => im.p === anchor).sort((a, b) => a.y - b.y || a.x - b.x),
  };
});

const lines = paragraphs
  .filter((p) => p.text && !/^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/.test(p.text))
  .map((p) => p.text);
const { questions } = parseQuestionBank(lines.join("\n"));
const qStart = new Map();
paragraphs.forEach((p, i) => {
  const mm = p.text.match(/^\s*(\d{1,2})\s*[.．、]\s*/);
  if (mm) qStart.set(Number(mm[1]), i);
});

const isFormula = (im) => im.h > 0 && im.h <= 80;

function imagesForSpan(start, end) {
  const list = [];
  pages.forEach((page) => {
    if (page.nextAnchor <= start || page.anchor >= end) return;
    const from = start <= page.anchor ? 0 : (page.bands.find((b) => b.index === start)?.top ?? 0);
    const lastPara = Math.min(end - 1, page.nextAnchor - 1);
    const to = end > page.nextAnchor ? PAGE_H : (page.bands.find((b) => b.index === lastPara)?.bottom ?? PAGE_H);
    page.images.forEach((im) => {
      if (im.y >= from - 2 && im.y < to + 2 && isFormula(im)) list.push(im);
    });
  });
  return list;
}

let totalNeed = 0;
let totalGot = 0;
console.log("页高:", PAGE_H, "| 页数:", pages.length, "| 题目数:", questions.length);
questions.forEach((question) => {
  const start = qStart.has(question.number) ? qStart.get(question.number) : 0;
  const end = qStart.get(question.number + 1) ?? paragraphs.length;
  const supply = imagesForSpan(start, end);
  const needTitle = formulaCount(question.title);
  const needOptions = (question.options || []).reduce((s, o) => s + formulaCount(o.content), 0);
  const needAnswer = formulaCount(question.answerText || "");
  const needExp = formulaCount(question.explanation || "");
  const need = needTitle + needOptions + needAnswer + needExp;
  const got = Math.min(need, supply.length);
  totalNeed += need;
  totalGot += got;
  const flag = supply.length < need ? `  ← 缺 ${need - supply.length}` : supply.length > need ? `  余${supply.length - need}` : "";
  console.log(
    ` 第${String(question.number).padStart(2)}题 段[${start}..${end}) 需要${need}(题${needTitle}/选${needOptions}/答${needAnswer}/析${needExp}) 供给${supply.length}${flag}`,
  );
});
console.log("合计需求:", totalNeed, "| 合计命中:", totalGot);
