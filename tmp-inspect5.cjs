const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const i = xml.indexOf("侯德榜");
console.log("侯德榜 出现位置:", i);

// 找到包含它的段落
const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
let m;
let idx = 0;
let found = null;
while ((m = pRe.exec(xml))) {
  if (m.index <= i && i < m.index + m[0].length) {
    found = { idx, start: m.index, content: m[1], raw: m[0] };
    break;
  }
  idx += 1;
}

console.log("所在段落序号:", found.idx, "| 段落原始长度:", found.raw.length);
console.log("\n--- 段落完整原始 XML ---");
console.log(found.raw);
