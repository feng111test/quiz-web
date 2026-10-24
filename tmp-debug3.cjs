const fs = require("fs");
const path = require("path");
const UTILS = "D:/Users/fql/WeChatProjects/miniprogram-1/miniprogram/utils";

let src = fs.readFileSync(path.resolve(UTILS, "docx.js"), "utf8");

// 在关键点插入日志
src = src.replace(
  "  blockRanges(body).forEach(function (block, index) {",
  "  console.log('[dbg] blockRanges 数量:', blockRanges(body).length);\n  blockRanges(body).forEach(function (block, index) {"
);
src = src.replace(
  "    var line = paragraphLine(content);\n    if (line) lines.push(line);",
  "    var line = paragraphLine(content);\n    if (line) lines.push(line);"
);

const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => ({}));
const docx = mod.exports;

const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

console.log("=== 测试 extractText ===");
const text = docx.extractText(xml);
console.log("长度:", text.length);

console.log("\n=== 测试 parseDocument ===");
const res = docx.parseDocument(xml, "");
console.log("images:", res.images.length);
console.log("text 长度:", res.text.length);
console.log("前 300 字符:");
console.log(JSON.stringify(res.text.slice(0, 300)));
