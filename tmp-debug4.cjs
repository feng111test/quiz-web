const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

// 取第一段
const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const m = pRe.exec(xml);
const content = m[1];
console.log("第一段内容长度:", content.length);

const RUN_RE = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
let rm;
let count = 0;
while ((rm = RUN_RE.exec(content))) {
  count += 1;
  if (count <= 3) console.log(`  run${count}:`, JSON.stringify(rm[1].slice(0, 120)));
}
console.log("run 总数:", count);

// 检查 spacing 匹配
const SPACING_RE = /<w:spacing\b[^>]*?w:val="(-?[0-9.]+)"/;
console.log("\nspacing 测试:", SPACING_RE.exec(content));

// 逐 run 检查
RUN_RE.lastIndex = 0;
let i = 0;
while ((rm = RUN_RE.exec(content))) {
  i += 1;
  const run = rm[1];
  const sp = (run.match(SPACING_RE) || [])[1];
  const texts = (run.match(/<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g) || []).map((s) =>
    s.replace(/<[^>]+>/g, "")
  );
  const joined = texts.join("");
  if (i <= 18) {
    console.log(
      `  run${i}: spacing=${sp} text=${JSON.stringify(joined.slice(0, 20))} isSlot=${
        sp !== undefined && ((Number(sp) >= 150 && Number(sp) <= 1100) || Number(sp) >= 4000) && !joined.trim()
      }`
    );
  }
}
