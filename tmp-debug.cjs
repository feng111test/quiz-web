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
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

console.log("xml 长度:", xml.length);
console.log("body 标签位置:", xml.indexOf("<w:body>"));
console.log("段落匹配数:", (xml.match(/<w:p(?:\s[^>]*)?>/g) || []).length);
console.log("pict 匹配数:", (xml.match(/<w:pict\b[^>]*>/g) || []).length);
console.log("run 匹配数:", (xml.match(/<w:r\b[^>]*>/g) || []).length);

const text = docx.extractText(xml);
console.log("extractText 长度:", text.length);
console.log("前 200 字符:", JSON.stringify(text.slice(0, 200)));

const res = docx.parseDocument(xml, "");
console.log("parseDocument images:", res.images.length);
