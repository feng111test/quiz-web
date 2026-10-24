const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const paragraphs = [];
let m;
while ((m = pRe.exec(xml))) paragraphs.push(m[1]);

console.log("段落总数:", paragraphs.length);
[0, 11, 30].forEach((i) => {
  const c = paragraphs[i];
  const texts = (c.match(/<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g) || []).map((s) =>
    s.replace(/<[^>]+>/g, "")
  );
  const picts = (c.match(/<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g) || []).length;
  console.log(`\n段#${i}: 内容长度=${c.length} 文本段数=${texts.length} pict数=${picts}`);
  console.log("  文本:", JSON.stringify(texts.join("|").slice(0, 200)));
  console.log("  开头 600 字符:", c.slice(0, 600));
});
