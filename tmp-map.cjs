const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const num = (style, prop) => {
  const m = style && style.match(new RegExp(prop + ":([0-9.]+)pt"));
  return m ? Number(m[1]) : 0;
};

// 收集所有顶层段落及其内容
const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const paragraphs = [];
let m;
while ((m = pRe.exec(xml))) paragraphs.push(m[1]);

function textOf(content) {
  let text = "";
  const tRe = /<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>|<w:(tab)\b[^>]*(?:\/>|>)/g;
  let tm;
  while ((tm = tRe.exec(content))) text += tm[1] === "tab" ? " " : tm[1] !== undefined ? tm[1] : "";
  return text.trim();
}

const imageRe = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
const imageParagraphs = [];
paragraphs.forEach((content, index) => {
  const picts = content.match(imageRe) || [];
  if (!picts.length) return;
  const items = [];
  picts.forEach((pict) => {
    const idm = pict.match(/<v:imagedata\b[^>]*?r:id="([^"]*)"/);
    const sm = pict.match(/<v:shape\b[^>]*?style="([^"]*)"/);
    const style = sm ? sm[1] : "";
    items.push({
      rid: idm ? idm[1] : null,
      w: num(style, "width"),
      h: num(style, "height"),
      x: num(style, "margin-left"),
      y: num(style, "margin-top"),
    });
  });
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  imageParagraphs.push({ index, count: items.length, first: items[0], last: items[items.length - 1] });
});

console.log("段落总数:", paragraphs.length);
console.log("\n--- 含图片的段落 ---");
imageParagraphs.forEach((p) => {
  console.log(
    ` 段#${p.index} 图片${p.count}张 y:[${p.first.y}..${p.last.y}] 文本="${textOf(paragraphs[p.index]).slice(0, 30)}"`
  );
});

console.log("\n--- 题号所在段落 ---");
paragraphs.forEach((content, index) => {
  const t = textOf(content);
  const qm = t.match(/^(\d{1,2})\s*[.．、]\s*/);
  if (qm) console.log(` 第${qm[1]}题 -> 段#${index}  "${t.slice(0, 30)}"`);
});
