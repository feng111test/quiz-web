const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const bodyStart = xml.indexOf("<w:body>");
const bodyEnd = xml.lastIndexOf("</w:body>");
const body = xml.slice(bodyStart + 8, bodyEnd);

const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const paragraphs = [];
let m;
while ((m = pRe.exec(body))) paragraphs.push(m[1]);

// 按 web 的规则识别“公式占位 run”：空文本 + spacing 在 [150,1100] 或 >=4000
const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
let gapCount = 0;
const gapByParagraph = {};
paragraphs.forEach((content, index) => {
  let count = 0;
  let rm;
  runRe.lastIndex = 0;
  while ((rm = runRe.exec(content))) {
    const run = rm[1];
    const spacing = (run.match(/<w:spacing\b[^>]*w:val="([0-9.]+)"/) || [])[1];
    const texts = (run.match(/<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g) || []).map((s) =>
      s.replace(/<[^>]+>/g, "")
    );
    const text = texts.join("");
    if (!spacing) continue;
    const value = Number(spacing);
    const isFormulaSpacing = (value >= 150 && value <= 1100) || value >= 4000;
    if (isFormulaSpacing && !text.trim()) count += 1;
  }
  if (count) {
    gapByParagraph[index] = count;
    gapCount += count;
  }
});

console.log("公式占位(空 run + 特殊 spacing)总数:", gapCount);
console.log("含占位的段落数:", Object.keys(gapByParagraph).length);
console.log("pict 总数:", (xml.match(/<w:pict\b/g) || []).length);

// 各高度区间的图片数量
const shapeRe = /<v:shape\b[^>]*?style="([^"]*)"/g;
const heights = [];
let sm;
while ((sm = shapeRe.exec(xml))) {
  const hm = sm[1].match(/height:([0-9.]+)pt/);
  heights.push(hm ? Number(hm[1]) : 0);
}
const inRange = (lo, hi) => heights.filter((h) => h >= lo && h <= hi).length;
console.log("\n高度区间统计:");
console.log("  h < 4        :", heights.filter((h) => h < 4).length);
console.log("  4 <= h < 8   :", inRange(4, 7.99));
console.log("  8 <= h <= 60 :", inRange(8, 60));
console.log("  8 <= h <= 80 :", inRange(8, 80));
console.log("  h > 80       :", heights.filter((h) => h > 80).length);
