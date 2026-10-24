const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const m = xml.match(/<v:shape\b[\s\S]{0,2000}?<\/v:shape>/);
console.log("--- 一个完整的 v:shape ---");
console.log(m ? m[0] : "<未匹配>");

console.log("\n--- 前 30 个 r:id 值 ---");
const ids = xml.match(/<v:imagedata[^>]*r:id="([^"]+)"/g) || [];
ids.slice(0, 30).forEach((s, i) => console.log(i, s));

console.log("\n--- rels 里的图片关系 ---");
const rels = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-rels.xml", "utf8");
const rel = rels.match(/<Relationship[^>]*Target="media\/[^"]*"[^>]*>/g) || [];
rel.slice(0, 10).forEach((s) => console.log(" ", s));
console.log("总图片关系数:", rel.length);
