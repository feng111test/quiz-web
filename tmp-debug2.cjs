const fs = require("fs");
const path = require("path");
const UTILS = "D:/Users/fql/WeChatProjects/miniprogram-1/miniprogram/utils";

const src = fs.readFileSync(path.resolve(UTILS, "docx.js"), "utf8");
const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => ({}));
const docx = mod.exports;

const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

// 复刻内部逻辑逐步排查
const bodyStart = xml.indexOf("<w:body>");
const bodyEnd = xml.lastIndexOf("</w:body>");
const body = xml.slice(bodyStart + 8, bodyEnd);
console.log("body 长度:", body.length);

function tagRanges(source, tag) {
  const pattern = new RegExp("<w:" + tag + "\\b[^>]*>|</w:" + tag + ">", "g");
  const ranges = [];
  let depth = 0;
  let start = -1;
  let match;
  while ((match = pattern.exec(source))) {
    const token = match[0];
    if (token.charAt(1) === "/") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        ranges.push({ start: start, end: match.index + token.length });
        start = -1;
      }
    } else if (token.slice(-2) === "/>") {
      continue;
    } else {
      if (depth === 0) start = match.index;
      depth += 1;
    }
  }
  return ranges;
}

const p = tagRanges(body, "p");
console.log("顶层 p 区间数:", p.length);
const t = tagRanges(body, "tbl");
console.log("顶层 tbl 区间数:", t.length);
console.log("前3个 p 区间:", JSON.stringify(p.slice(0, 3)));

const firstContent = body.slice(p[0].start, p[0].end);
console.log("\n第一段内容长度:", firstContent.length);
console.log("第一段前 300 字符:");
console.log(firstContent.slice(0, 300));

const RUN_RE = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
let m;
let n = 0;
while ((m = RUN_RE.exec(firstContent))) n += 1;
console.log("\n第一段 run 数:", n);
