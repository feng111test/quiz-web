const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

function num(style, prop) {
  const m = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return m ? Number(m[1]) : 0;
}

const SHAPE_RE = /<v:shape\b[^>]*?style="([^"]*)"[^>]*>([\s\S]*?)<\/v:shape>/g;
const sizes = [];
let m;
while ((m = SHAPE_RE.exec(xml))) {
  const style = m[1];
  const inner = m[2];
  const idm = inner.match(/<v:imagedata\b[^>]*?r:id="([^"]*)"/);
  sizes.push({
    rid: idm ? idm[1] : null,
    w: num(style, "width"),
    h: num(style, "height"),
    x: num(style, "margin-left"),
    y: num(style, "margin-top"),
    hasMarginTop: /margin-top:/.test(style),
  });
}

console.log("v:shape 总数:", sizes.length);
console.log("有 r:id 的:", sizes.filter((s) => s.rid).length);

const hs = sizes.map((s) => s.h).sort((a, b) => a - b);
const ws = sizes.map((s) => s.w).sort((a, b) => a - b);
const q = (arr, p) => arr[Math.floor((arr.length - 1) * p)];
console.log("\n高度分布 (pt): min", q(hs, 0), "p25", q(hs, 0.25), "中位", q(hs, 0.5), "p75", q(hs, 0.75), "p90", q(hs, 0.9), "max", q(hs, 1));
console.log("宽度分布 (pt): min", q(ws, 0), "p25", q(ws, 0.25), "中位", q(ws, 0.5), "p75", q(ws, 0.75), "p90", q(ws, 0.9), "max", q(ws, 1));

console.log("\n高度 <=80pt 的数量:", sizes.filter((s) => s.h > 0 && s.h <= 80).length);
console.log("高度 <=80pt 且 宽度>=6 且高度>=6:", sizes.filter((s) => s.h > 0 && s.h <= 80 && s.w >= 6 && s.h >= 6).length);
console.log("宽度<6 或 高度<6 的数量:", sizes.filter((s) => !(s.w >= 6 && s.h >= 6)).length);

console.log("\n--- 前 15 个图片(按文档顺序) ---");
sizes.slice(0, 15).forEach((s, i) => console.log(` ${i}: rid=${s.rid} w=${s.w} h=${s.h} x=${s.x} y=${s.y}`));
