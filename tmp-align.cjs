const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const bodyStart = xml.indexOf("<w:body>");
const bodyEnd = xml.lastIndexOf("</w:body>");
const body = xml.slice(bodyStart + 8, bodyEnd);

const paragraphs = [];
{
  const re = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = re.exec(body))) paragraphs.push(m[1]);
}

const T_RE = /<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g;
const RUN_RE = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
const PICT_RE = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
const SHAPE_RE = /<v:shape\b[^>]*?style="([^"]*)"/;
const RID_RE = /<v:imagedata\b[^>]*?r:id="([^"]*)"/;

function styleNum(style, prop) {
  const m = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return m ? Number(m[1]) : 0;
}

// 统计“公式槽”
let gapTotal = 0;
const gapsByP = {};
// 统计图片
const images = [];

paragraphs.forEach((content, pIndex) => {
  let rm;
  RUN_RE.lastIndex = 0;
  let gaps = 0;
  while ((rm = RUN_RE.exec(content))) {
    const run = rm[1];
    const sm = (run.match(/<w:spacing\b[^>]*?w:val="([0-9.]+)"/) || [])[1];
    if (!sm) continue;
    const v = Number(sm);
    if (!((v >= 150 && v <= 1100) || v >= 4000)) continue;
    let text = "";
    let tm;
    T_RE.lastIndex = 0;
    while ((tm = T_RE.exec(run))) text += tm[1];
    if (!text.trim()) gaps += 1;
  }
  if (gaps) {
    gapsByP[pIndex] = gaps;
    gapTotal += gaps;
  }

  let pm;
  PICT_RE.lastIndex = 0;
  while ((pm = PICT_RE.exec(content))) {
    const pict = pm[1];
    const ridm = pict.match(RID_RE);
    const sm = pict.match(SHAPE_RE);
    const style = sm ? sm[1] : "";
    images.push({
      rid: ridm ? ridm[1] : null,
      w: styleNum(style, "width"),
      h: styleNum(style, "height"),
      x: styleNum(style, "margin-left"),
      y: styleNum(style, "margin-top"),
      pIndex,
    });
  }
});

console.log("公式槽总数:", gapTotal, "| 图片总数:", images.length);

// 页锚段落 = 含图片的段落
const anchors = [];
paragraphs.forEach((content, i) => {
  PICT_RE.lastIndex = 0;
  if (PICT_RE.exec(content)) anchors.push(i);
});
console.log("页锚段落数:", anchors.length);

console.log("\n--- 每页对比：图片数 (过滤后) vs 公式槽数 ---");
anchors.forEach((a, k) => {
  const next = k + 1 < anchors.length ? anchors[k + 1] : paragraphs.length;
  const pageImages = images.filter((im) => im.pIndex === a);
  const good = pageImages.filter((im) => im.w >= 6 && im.h >= 6 && im.h <= 80);
  let gaps = 0;
  for (let i = a; i < next; i++) gaps += gapsByP[i] || 0;
  console.log(
    ` 页${k + 1} [段${a}..${next - 1}]: 图片${pageImages.length} 过滤后${good.length} | 公式槽${gaps}`
  );
});
