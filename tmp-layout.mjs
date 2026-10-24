// 实验：按版面把浮动图片的 y 坐标映射到段落，验证能否与“该段含公式占位符”对上
import fs from "node:fs";

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
      if ((v >= 150 && v <= 1100) || v >= 4000 && !texts(run).trim()) isGap = true;
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

// 版面参数
const sect = xml.match(/<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/);
const pgSz = sect && sect[1].match(/<w:pgSz\b[^>]*?w:w="(\d+)"[^>]*?w:h="(\d+)"/);
const pgMar = sect && sect[1].match(/<w:pgMar\b[^>]*?w:left="(\d+)"[^>]*?w:right="(\d+)"/);
const pageW = pgSz ? Number(pgSz[1]) / 20 : 595;
const marginL = pgMar ? Number(pgMar[1]) / 20 : 90;
const marginR = pgMar ? Number(pgMar[2]) / 20 : 90;
console.log("页面宽(pt):", pageW, "| 左右边距:", marginL, marginR, "| 版心宽:", pageW - marginL - marginR);

const maxY = Math.max(...images.map((im) => im.y + im.h));
console.log("图片最大底部 y:", maxY.toFixed(1));

const CHARS_PER_LINE = 38;
const CHAR_WEIGHT = (ch) => (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55);
function weight(text) {
  let units = 0;
  let chars = 0;
  for (const ch of text) {
    if (ch === TOKEN_CHAR) {
      units += 4;
      chars += 4;
      continue;
    }
    units += CHAR_WEIGHT(ch);
    chars += 1;
  }
  const lines = Math.ceil(chars ? units / CHARS_PER_LINE : 0.35);
  return Math.max(0.35, lines);
}

// 页锚
const anchors = [...new Set(images.map((im) => im.p))].sort((a, b) => a - b);
const PAGE_H = Math.max(600, Math.ceil(maxY));

function layoutPage(anchor, nextAnchor) {
  const list = [];
  for (let i = anchor; i < nextAnchor; i += 1) list.push({ i, w: weight(paragraphs[i].text) });
  const total = list.reduce((s, item) => s + item.w, 0) || 1;
  let y = 0;
  return list.map((item) => {
    const top = y;
    const height = (item.w / total) * PAGE_H;
    y += height;
    return { ...item, top, bottom: y };
  });
}

for (const anchor of [580, 602]) {
  const nextAnchor = anchors.find((a) => a > anchor) ?? paragraphs.length;
  const layout = layoutPage(anchor, nextAnchor);
  const pageImages = images.filter((im) => im.p === anchor).sort((a, b) => a.y - b.y || a.x - b.x);
  console.log(`\n===== 页锚段落 ${anchor}（段落 ${anchor}..${nextAnchor - 1}）图片 ${pageImages.length} 张 =====`);
  layout.forEach((item) => {
    const got = pageImages.filter((im) => im.y >= item.top - 2 && im.y < item.bottom + 2);
    const ph = (paragraphs[item.i].text.match(new RegExp(TOKEN_CHAR, "g")) || []).length;
    const flag = got.length !== ph ? "  ← 差" : "";
    console.log(
      ` 段${String(item.i).padStart(3)} y[${item.top.toFixed(0)}..${item.bottom.toFixed(0)}] 占位${ph} 落图${got.length}${flag} | ${paragraphs[item.i].text.slice(0, 30).replace(new RegExp(TOKEN_CHAR, "g"), "◆")}`,
    );
  });
}
