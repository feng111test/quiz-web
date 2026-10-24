const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const UTILS = "D:/Users/fql/WeChatProjects/miniprogram-1/miniprogram/utils";
const cache = {};
function loadCjs(file) {
  const full = path.resolve(UTILS, file);
  if (cache[full]) return cache[full].exports;
  const src = fs.readFileSync(full, "utf8");
  const mod = { exports: {} };
  cache[full] = mod;
  const req = (rel) => loadCjs((rel.startsWith("./") ? rel.slice(2) : rel) + (rel.endsWith(".js") ? "" : ".js"));
  new Function("module", "exports", "require", src)(mod, mod.exports, req);
  return mod.exports;
}

const docx = loadCjs("docx.js");

JSZip.loadAsync(fs.readFileSync("F:/BaiduNetdiskDownload/2025年高考化学试卷（山东卷）（解析卷）.docx")).then(async (zip) => {
  const xml = await zip.file("word/document.xml").async("string");
  const rels = await zip.file("word/_rels/document.xml.rels").async("string");

  const result = docx.parseDocument(xml, rels);
  const text = docx.examText(result.text);
  const gaps = text.split(docx.FORMULA_PLACEHOLDER).length - 1;

  console.log("提取文本长度:", text.length);
  console.log("公式槽数量  :", gaps);
  console.log("图片数量    :", result.images.length);
  console.log("路径解析成功:", result.images.filter((i) => i.path).length);

  console.log("\n--- 前 20 行 ---");
  text.split("\n").slice(0, 20).forEach((l, i) => console.log(String(i).padStart(2) + "| " + l));

  fs.writeFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-text.txt", text);
});
