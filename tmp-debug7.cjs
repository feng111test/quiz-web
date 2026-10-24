const fs = require("fs");
const path = require("path");
const UTILS = "D:/Users/fql/WeChatProjects/miniprogram-1/miniprogram/utils";

let src = fs.readFileSync(path.resolve(UTILS, "docx.js"), "utf8");
src +=
  "\nmodule.exports.__debug = { tagRanges: tagRanges, blockRanges: blockRanges, paragraphLine: paragraphLine, runText: runText, isFormulaSlot: isFormulaSlot, bodyContent: bodyContent, collectBlockImages: collectBlockImages };\n";

const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => ({}));
const docx = mod.exports;
const D = docx.__debug;

const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");
const body = D.bodyContent(xml);
console.log("body 长度:", body.length);
console.log("body 前 120 字符:", JSON.stringify(body.slice(0, 120)));

const blocks = D.blockRanges(body);
console.log("blocks:", blocks.length);
console.log("blocks[0]:", JSON.stringify(blocks[0]));
console.log("blocks[1]:", JSON.stringify(blocks[1]));

const c0 = body.slice(blocks[0].start, blocks[0].end);
console.log("c0 长度:", c0.length);

const RUN_RE = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
console.log("c0 run 数:", (c0.match(RUN_RE) || []).length);
