const fs = require("fs");
const path = require("path");
const UTILS = "D:/Users/fql/WeChatProjects/miniprogram-1/miniprogram/utils";

let src = fs.readFileSync(path.resolve(UTILS, "docx.js"), "utf8");

// 在 parseDocument 里插入逐步日志
src = src.replace(
  "  blockRanges(body).forEach(function (block, index) {\n    var content = body.slice(block.start, block.end);",
  "  var __blocks = blockRanges(body);\n  console.log('[dbg] blocks:', __blocks.length);\n  __blocks.slice(0, 3).forEach(function (b, i) {\n    console.log('[dbg] block' + i + ' type=' + b.type + ' len=' + (b.end - b.start));\n  });\n  __blocks.forEach(function (block, index) {\n    var content = body.slice(block.start, block.end);"
);

src = src.replace(
  "    var line = paragraphLine(content);\n    if (line) lines.push(line);\n  });",
  "    var line = paragraphLine(content);\n    if (index < 3) console.log('[dbg] line' + index + ':', JSON.stringify(line.slice(0, 60)));\n    if (line) lines.push(line);\n  });\n  console.log('[dbg] lines:', lines.length);"
);

const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => ({}));
const docx = mod.exports;

const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");
const res = docx.parseDocument(xml, "");
console.log("最终结果 text 长度:", res.text.length, "| images:", res.images.length);
