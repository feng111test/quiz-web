const fs = require("fs");
const xml = fs.readFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", "utf8");

const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const paragraphs = [];
let m;
while ((m = pRe.exec(xml))) paragraphs.push(m[1]);

function textOf(content) {
  let text = "";
  const tRe = /<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>/g;
  let tm;
  while ((tm = tRe.exec(content))) text += tm[1];
  return text.trim();
}

const imageRe = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
console.log("--- 全部含图片的段落 (共25个) ---");
paragraphs.forEach((content, index) => {
  const picts = content.match(imageRe) || [];
  if (!picts.length) return;
  const ys = picts
    .map((p) => {
      const sm = p.match(/<v:shape\b[^>]*?style="([^"]*)"/);
      const ym = sm && sm[1].match(/margin-top:([0-9.]+)pt/);
      return ym ? Number(ym[1]) : 0;
    })
    .sort((a, b) => a - b);
  console.log(
    ` 段#${index}: ${picts.length}张 y=[${ys[0]}..${ys[ys.length - 1]}] "${textOf(content).slice(0, 24)}"`
  );
});
