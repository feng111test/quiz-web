// 诊断：第 20 题为什么没匹配到公式图片
import fs from "node:fs";
import { parseQuestionBank } from "./word-quiz/src/word-parser.js";
import { formulaCount } from "./src/question-text.js";

const xml = fs.readFileSync("tmp-doc.xml", "utf8");
const bodyStart = xml.indexOf("<w:body>");
const bodyEnd = xml.lastIndexOf("</w:body>");
const body = xml.slice(bodyStart + 8, bodyEnd);

// 顶层 p（用深度计数跳过嵌套，例如表格里的段落）
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
const RID_RE = /<v:imagedata\b[^>]*?r:id="([^"]*)"/;

const TOKEN_CHAR = "\uE000";
function paragraphText(content) {
  let text = "";
  let rm;
  RUN_RE.lastIndex = 0;
  let rest = content;
  // 简化：先按 run 判断占位符，再拼所有 t 文本
  let out = "";
  let lastIndex = 0;
  while ((rm = RUN_RE.exec(content))) {
    const run = rm[1];
    const sm = run.match(SPACING_RE);
    let isGap = false;
    if (sm) {
      const v = Number(sm[1]);
      if ((v >= 150 && v <= 1100) || v >= 4000) {
        let t = "";
        let tm;
        T_RE.lastIndex = 0;
        while ((tm = T_RE.exec(run))) t += tm[1];
        if (!t.trim()) isGap = true;
      }
    }
    if (isGap) out += TOKEN_CHAR;
    else {
      let t = "";
      let tm;
      T_RE.lastIndex = 0;
      while ((tm = T_RE.exec(run))) t += tm[1];
      out += t;
    }
    lastIndex = rm.index + rm[0].length;
  }
  // run 之外的 t（例如 hyperlink 内）
  void lastIndex;
  void text;
  return out.replace(/<tab\b[^>]*\/>/g, " ").replace(/\u00a0/g, " ").trim();
}

function styleNum(style, prop) {
  const mm = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return mm ? Number(mm[1]) : 0;
}

const paragraphs = [];
const images = [];
blocks.forEach((block, index) => {
  const content = body.slice(block.start, block.end);
  const text = paragraphText(content);
  paragraphs.push({ index, type: block.type, text });
  let pm;
  PICT_RE.lastIndex = 0;
  while ((pm = PICT_RE.exec(content))) {
    const pict = pm[1];
    const sm = pict.match(SHAPE_RE);
    const style = sm ? sm[1] : "";
    images.push({
      p: index,
      rid: (pict.match(RID_RE) || [])[1] || null,
      w: styleNum(style, "width"),
      h: styleNum(style, "height"),
      x: styleNum(style, "margin-left"),
      y: styleNum(style, "margin-top"),
    });
  }
});

const lines = paragraphs
  .filter((p) => p.type === "p" && p.text && !/^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/.test(p.text))
  .map((p) => p.text);

const startIndex = paragraphs.findIndex((p) => p.text.includes("产率增大"));
console.log("含“产率增大”的段落号:", startIndex);

const { questions } = parseQuestionBank(lines.join("\n"));
console.log("解析出的题目数:", questions.length);

// 题号 → 顶层段落下标
const qIndex = new Map();
paragraphs.forEach((p, i) => {
  const mm = p.text.match(/^\s*(\d{1,2})\s*[.．、]\s*/);
  if (mm) qIndex.set(Number(mm[1]), i);
});
console.log("题号→段落:", [...qIndex.entries()].map(([k, v]) => `${k}@${v}`).join(" "));

const target = questions.find((q) => q.number === 20) || questions[19];
console.log("\n=== 第", target.number, "题 ===");
console.log("题干占位符:", formulaCount(target.title), "| 选项占位符:", target.options.map((o) => `${o.key}:${formulaCount(o.content)}`).join(" "), "| 解析占位符:", formulaCount(target.explanation));
console.log("题干:", target.title.slice(0, 120).replace(/\uE000/g, "〔公式〕"));

const start = qIndex.get(target.number);
const next = qIndex.get(target.number + 1) ?? paragraphs.length;
console.log("段落范围:", start, "→", next);

const inRange = images.filter((im) => im.p >= start && im.p < next);
const formula = inRange.filter((im) => im.h > 0 && im.h <= 80);
console.log("范围内图片:", inRange.length, "| 过滤后(高<=80):", formula.length);
console.log("范围内图片所在段落:", [...new Set(inRange.map((im) => im.p))].join(","));
console.log("范围内图片尺寸样例:", inRange.slice(0, 12).map((im) => `${im.w}x${im.h}@y${im.y}`).join(" "));

// 全文：按“页锚段落”统计图片，找出第 20 题所在页
const anchors = [...new Set(images.map((im) => im.p))].sort((a, b) => a - b);
console.log("\n页锚段落:", anchors.join(","));
const pageOfQ = anchors.filter((a) => a <= start).pop();
console.log("第 20 题所属页锚段落:", pageOfQ, "下一页锚:", anchors.find((a) => a > start));
const pageImages = images.filter((im) => im.p === pageOfQ).sort((a, b) => a.y - b.y || a.x - b.x);
console.log("该页图片数:", pageImages.length, "| 高<=80 的:", pageImages.filter((im) => im.h > 0 && im.h <= 80).length);
console.log("该页图片(按y):", pageImages.slice(0, 40).map((im) => `${im.h}h@y${im.y}`).join(" "));
