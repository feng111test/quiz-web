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
const blocks = D.blockRanges(body);
console.log("blocks:", blocks.length);

const c0 = body.slice(blocks[0].start, blocks[0].end);
console.log("block0 内容长度:", c0.length);

const RUN_RE = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
let n = 0;
let mm;
while ((mm = RUN_RE.exec(c0))) n += 1;
console.log("block0 run 数:", n);

console.log("paragraphLine(block0) =", JSON.stringify(D.paragraphLine(c0)));

const c11 = body.slice(blocks[11].start, blocks[11].end);
console.log("\nblock11 =", JSON.stringify(D.paragraphLine(c11)));
