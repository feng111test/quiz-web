const JSZip = require("jszip");
const fs = require("fs");

JSZip.loadAsync(fs.readFileSync("F:/BaiduNetdiskDownload/2025年高考化学试卷（山东卷）（解析卷）.docx")).then(async (zip) => {
  const xml = await zip.file("word/document.xml").async("string");
  const rels = await zip.file("word/_rels/document.xml.rels").async("string");
  fs.writeFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-rels.xml", rels);
  console.log("已保存 rels, 长度", rels.length);
});
