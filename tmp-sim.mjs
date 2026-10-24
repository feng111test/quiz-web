// 模拟 loadWord 的图片分配流程，对比「按段落范围」与「从游标开始」两种策略
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
const RID_RE = /<v:imagedata\b[^>]*?r:id="([^"]*)"/;
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
  return out.replace(/<w:tab\b[^>]*\/>/g, " ").replace(/\u00a0/g, " ").trim();
}

function styleNum(style, prop) {
  const mm = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return mm ? Number(mm[1]) : 0;
}

const paragraphs = [];
const images = [];
blocks.forEach((block, index) => {
  const content = body.slice(block.start, block.end);
  paragraphs.push({ index, type: block.type, text: paragraphText(content) });
  let pm;
  PICT_RE.lastIndex = 0;
  while ((pm = PICT_RE.exec(content))) {
    const pict = pm[1];
    const style = (pict.match(SHAPE_RE) || [])[1] || "";
    const w = styleNum(style, "width");
    const h = styleNum(style, "height");
    if (w < 6 || h < 6) continue;
    images.push({
      p: index,
      rid: (pict.match(RID_RE) || [])[1] || null,
      w,
      h,
      x: styleNum(style, "margin-left"),
      y: styleNum(style, "margin-top"),
    });
  }
});

// 复刻 extractFormulaImagePages 的 rows 分组
const ROW_TOLERANCE = 3;
const pages = [];
paragraphs.forEach((para, paragraphIndex) => {
  const list = images.filter((im) => im.p === paragraphIndex);
  if (!list.length) return;
  const rows = [];
  for (const image of list.sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.at(-1);
    if (!row || Math.abs(row.y - image.y) > ROW_TOLERANCE) {
      row = { y: image.y, images: [] };
      rows.push(row);
    }
    row.images.push(image);
  }
  pages.push({ paragraphIndex, rows });
});

const isFormulaImage = (image) => image.h > 0 && image.h <= 80;
const lines = paragraphs
  .filter((p) => p.type === "p" && p.text && !/^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/.test(p.text))
  .map((p) => p.text);
const { questions } = parseQuestionBank(lines.join("\n"));

const qIndex = new Map();
paragraphs.forEach((p, i) => {
  const mm = p.text.match(/^\s*(\d{1,2})\s*[.．、]\s*/);
  if (mm) qIndex.set(Number(mm[1]), i);
});

function demand(question) {
  const title = formulaCount(question.title);
  const options = (question.options || []).reduce((sum, o) => sum + formulaCount(o.content), 0);
  return title + options;
}

// ---------- 通用 ----------
function itemsFrom(startPage, endPage, cursor) {
  const items = [];
  pages.forEach((page, pageIndex) => {
    if (pageIndex < startPage || pageIndex > endPage) return;
    page.rows.forEach((row, rowIndex) => {
      if (pageIndex < cursor.page || (pageIndex === cursor.page && rowIndex < cursor.row)) return;
      row.images.filter(isFormulaImage).forEach((image) => items.push({ image, page: pageIndex, row: rowIndex }));
    });
  });
  return items;
}

/** 段落落在哪一页（页锚段落 <= 段落号 的最后一页） */
function pageOfParagraph(paragraphIndex) {
  let found = 0;
  pages.forEach((page, i) => {
    if (page.paragraphIndex <= paragraphIndex) found = i;
  });
  return found;
}

function firstPageAtOrAfter(paragraphIndex) {
  const found = pages.findIndex((page) => page.paragraphIndex >= paragraphIndex);
  return found < 0 ? pages.length : found;
}

function lastPageBefore(paragraphIndex) {
  let found = -1;
  pages.forEach((page, i) => {
    if (page.paragraphIndex < paragraphIndex) found = i;
  });
  return found;
}

/** 第二轮：解析图片（复刻 collectExplanationImages 的游标推进） */
function collectExplanation(positions) {
  const got = [];
  let cursor = { page: 0, row: 0 };
  questions.forEach((question, index) => {
    if (positions[index]) cursor = positions[index];
    const endCursor = positions.slice(index + 1).find(Boolean) || { page: pages.length, row: 0 };
    let remaining = formulaCount(question.explanation || "");
    let page = cursor.page;
    let row = cursor.row;
    let taken = 0;
    while (remaining > 0 && page < pages.length) {
      if (page > endCursor.page || (page === endCursor.page && row >= endCursor.row)) break;
      const rows = pages[page].rows;
      while (remaining > 0 && row < rows.length) {
        if (page === endCursor.page && row >= endCursor.row) break;
        const list = rows[row].images.filter(isFormulaImage);
        taken += Math.min(remaining, list.length);
        remaining -= list.length;
        row += 1;
      }
      if (remaining > 0 && row >= rows.length) {
        page += 1;
        row = 0;
      }
    }
    got.push(taken);
  });
  return got;
}

/** 从游标顺序取图，最多取到 endPage 结束 */
function takeImages(cursor, endPage, count) {
  const taken = [];
  let page = cursor.page;
  let row = cursor.row;
  while (taken.length < count && page <= endPage && page < pages.length) {
    const rows = pages[page].rows;
    while (taken.length < count && row < rows.length) {
      rows[row].images.filter(isFormulaImage).forEach((image) => {
        if (taken.length < count) taken.push({ image, page, row });
      });
      row += 1;
    }
    if (row >= rows.length && taken.length < count) {
      page += 1;
      row = 0;
    }
  }
  const last = taken.at(-1);
  return { taken, cursor: last ? { page: last.page, row: last.row + 1 } : { page, row } };
}

function simulate(mode) {
  let cursor = { page: 0, row: 0 };
  const report = [];
  const positions = [];
  questions.forEach((question) => {
    const start = qIndex.has(question.number) ? qIndex.get(question.number) : null;
    const end = qIndex.get(question.number + 1) ?? Number.POSITIVE_INFINITY;
    const need = demand(question) + (mode === "C" ? formulaCount(question.answerText || "") : 0);
    let items;
    if (mode === "A") {
      // 现状：页锚段落落在 [start, end) 的页，从页首取
      const from = start === null ? 0 : firstPageAtOrAfter(start);
      const to = end === Number.POSITIVE_INFINITY ? pages.length - 1 : lastPageBefore(end);
      items = itemsFrom(from, to, { page: 0, row: 0 });
    } else {
      // C：从题号所在页开始，游标只前进不后退
      const startPage = start === null ? 0 : pageOfParagraph(start);
      const endPage = end === Number.POSITIVE_INFINITY ? pages.length - 1 : pageOfParagraph(end);
      if (cursor.page < startPage) cursor = { page: startPage, row: 0 };
      items = itemsFrom(startPage, endPage, cursor);
    }
    const take = items.slice(0, need);
    const last = take.at(-1);
    if (last) cursor = { page: last.page, row: last.row + 1 };
    positions.push(last ? { page: last.page, row: last.row + 1 } : null);
    report.push({
      n: question.number,
      need,
      supply: items.length,
      got: take.length,
      firstPage: take.length ? pages[take[0].page].paragraphIndex : null,
    });
  });
  if (mode === "C2") {
    // 解析图片也用本题的页范围做上界，紧跟题干游标继续取
    let cursor2 = { page: 0, row: 0 };
    questions.forEach((question, index) => {
      const start = qIndex.has(question.number) ? qIndex.get(question.number) : null;
      const end = qIndex.get(question.number + 1) ?? Number.POSITIVE_INFINITY;
      const startPage = start === null ? 0 : pageOfParagraph(start);
      const endPage = end === Number.POSITIVE_INFINITY ? pages.length - 1 : pageOfParagraph(end);
      if (cursor2.page < startPage) cursor2 = { page: startPage, row: 0 };
      const result = takeImages(cursor2, endPage, formulaCount(question.explanation || ""));
      cursor2 = result.cursor;
      report[index].expGot = result.taken.length;
      report[index].expNeed = formulaCount(question.explanation || "");
    });
    return report;
  }

  const exp = collectExplanation(positions);
  report.forEach((item, index) => {
    item.expNeed = formulaCount(questions[index].explanation || "");
    item.expGot = exp[index];
  });
  return report;
}

console.log("题目数:", questions.length, "| 页锚数:", pages.length, "| 图片总数:", images.length);
console.log("公式尺寸图片总数:", pages.reduce((s, p) => s + p.rows.reduce((t, r) => t + r.images.filter(isFormulaImage).length, 0), 0));
console.log("题目总需求:", questions.reduce((s, q) => s + demand(q), 0), "| 解析总需求:", questions.reduce((s, q) => s + formulaCount(q.explanation), 0));

for (const mode of ["A", "C", "C2"]) {
  console.log(`\n===== 策略${mode}：${mode === "A" ? "现状" : "题号所在页 + 顺序游标"} =====`);
  const report = simulate(mode);
  let miss = 0;
  report.forEach((r) => {
    const lackStem = r.need - r.got;
    const lackExp = Math.max(0, r.expNeed - r.expGot);
    miss += lackStem + lackExp;
    console.log(
      ` 第${String(r.n).padStart(2)}题: 题干需${r.need} 实得${r.got}(缺${lackStem}) | 解析需${r.expNeed} 实得${r.expGot}(缺${lackExp}) | 起始页锚${r.firstPage}`,
    );
  });
  console.log(" 合计缺图:", miss);
}
