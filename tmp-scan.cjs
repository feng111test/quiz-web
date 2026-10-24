// 验证：图片锚定在哪些段落？题号在哪些段落？两者能否对上？
const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

// 取 body 内容
const bodyStart = xml.indexOf("<w:body>");
const bodyEnd = xml.lastIndexOf("</w:body>");
const body = xml.slice(bodyStart + 8, bodyEnd);
console.log("body 长度:", body.length);

// 扫描顶层 p / tbl（用深度计数跳过嵌套）
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
    if (depth === 0 && !current) current = { type: tag, start: m.index, openEnd: m.index + raw.length };
    depth += 1;
  }
}

console.log("顶层块数量:", blocks.length);
const counts = blocks.reduce((acc, b) => ((acc[b.type] = (acc[b.type] || 0) + 1), acc), {});
console.log("块类型统计:", JSON.stringify(counts));

// 文本的提取（含占位符识别）
function textWithMarks(content) {
  let text = "";
  const re = /<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g;
  let tm;
  while ((tm = re.exec(content))) text += tm[1];
  return text.trim();
}

// 统计每个顶层块的图片数
const pictRe = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
console.log("\n--- 顶层块中图片的分布 ---");
let total = 0;
blocks.forEach((b, i) => {
  const content = body.slice(b.start, b.end);
  const picts = content.match(pictRe) || [];
  if (!picts.length) return;
  total += picts.length;
  const t = textWithMarks(content);
  const ys = picts
    .map((p) => {
      const sm = p.match(/<v:shape\b[^>]*?style="([^"]*)"/);
      const ym = sm && sm[1].match(/margin-top:([0-9.]+)pt/);
      return ym ? Number(ym[1]) : 0;
    })
    .sort((a, b) => a - b);
  console.log(` 块#${i} (${b.type}): ${picts.length}张 y=[${ys[0]}..${ys[ys.length - 1]}] "${t.slice(0, 22)}"`);
});
console.log("顶层块内图片总数:", total);
