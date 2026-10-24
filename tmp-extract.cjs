const JSZip = require("jszip");
const fs = require("fs");

JSZip.loadAsync(fs.readFileSync("F:/BaiduNetdiskDownload/2025年高考化学试卷（山东卷）（解析卷）.docx")).then(async (zip) => {
  const xml = await zip.file("word/document.xml").async("string");
  fs.writeFileSync("D:/Users/fql/WeChatProjects/quiz-web/tmp-doc.xml", xml);

  const count = (re) => (xml.match(re) || []).length;
  console.log("document.xml 长度:", xml.length);
  console.log("<v:shape      :", count(/<v:shape[ >]/g));
  console.log("<v:imagedata  :", count(/<v:imagedata[ >]/g));
  console.log("<w:drawing    :", count(/<w:drawing[ >]/g));
  console.log("<a:blip       :", count(/<a:blip[ >]/g));
  console.log("<w:pict       :", count(/<w:pict[ >]/g));
  console.log("<w:object     :", count(/<w:object[ >]/g));
  console.log("<mc:AlternateContent:", count(/<mc:AlternateContent[ >]/g));
  console.log("r:embed       :", count(/r:embed=/g));
  console.log("r:id          :", count(/r:id=/g));

  console.log("\n--- media 文件列表 ---");
  Object.keys(zip.files)
    .filter((p) => p.startsWith("word/media/"))
    .forEach((p) => console.log("  ", p, zip.files[p]._data?.uncompressedSize ?? "?"));

  // 第一段含图片的段落，打印原文看结构
  const idx = xml.search(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<v:shape/);
  console.log("\n--- 首个含 v:shape 的段落（截取 2500 字符）---");
  console.log(xml.slice(idx, idx + 2500));
}).catch((e) => console.log("ERR", e.message));
