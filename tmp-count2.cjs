const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const bodyStart = xml.indexOf("<w:body>");
const bodyEnd = xml.lastIndexOf("</w:body>");
const body = xml.slice(bodyStart + 8, bodyEnd);

// 顶层段落
const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const paragraphs = [];
let m;
while ((m = pRe.exec(body))) paragraphs.push(m[1]);

const num = (style, prop) => {
  const mm = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return mm ? Number(mm[1]) : 0;
};

// 按文档顺序收集所有 pict 图片
const pictRe = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
const allImages = [];
paragraphs.forEach((content, pIndex) => {
  let pm;
  pictRe.lastIndex = 0;
  while ((pm = pictRe.exec(content))) {
    const pict = pm[1];
    const idm = pict.match(/<v:imagedata\b[^>]*?r:id="([^"]*)"/);
    const sm = pict.match(/<v:shape\b[^>]*?style="([^"]*)"/);
    const style = sm ? sm[1] : "";
    allImages.push({
      rid: idm ? idm[1] : null,
      w: num(style, "width"),
      h: num(style, "height"),
      x: num(style, "margin-left"),
      y: num(style, "margin-top"),
      pIndex,
    });
  }
});

console.log("pict 总数:", allImages.length);
const rids = allImages.map((i) => i.rid);
console.log("唯一 rid 数:", new Set(rids).size);

// 按 web 的 spacing 规则数“公式槽”
const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
let gapTotal = 0;
const gapsByParagraph = {};
paragraphs.forEach((content, pIndex) => {
  let rm;
  runRe.lastIndex = 0;
  let count = 0;
  while ((rm = runRe.exec(content))) {
    const run = rm[1];
    const sm = (run.match(/<w:spacing\b[^>]*w:val="([0-9.]+)"/) || [])[1];
    const text = ((run.match(/<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g) || [])
      .map((s) => s.replace(/<[^>]+>/g, ""))
      .join("");
    if (!sm) continue;
    const v = Number(sm);
    if (((v >= 150 && v <= 1100) || v >= 4000) && !text.trim()) count += 1;
  }
  if (count) {
    gapsByParagraph[pIndex] = count;
    gapTotal += count;
  }
});

console.log("\n公式槽(占位 run)总数:", gapTotal);
console.log("含公式槽的段落数:", Object.keys(gapsByParagraph).length);

// 过滤后的图片
const filtered = allImages.filter((i) => i.h > 0 && i.h <= 80 && i.w >= 6);
console.log("\n过滤后(6<=w, 0<h<=80)的图片数:", filtered.length);

// 每个“页锚段落”的图片数
const anchors = [];
paragraphs.forEach((content, pIndex) => {
  const c = (content.match(pictRe) || []).length;
  if (c) anchors.push({ pIndex, count: c });
});
console.log("\n页锚段落:", JSON.stringify(anchors.map((a) => a.pIndex)));
console.log("页锚段落图片数:", JSON.stringify(anchors.map((a) => a.count)));
