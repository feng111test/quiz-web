const JSZip = require("jszip");
const fs = require("fs");

JSZip.loadAsync(fs.readFileSync("F:/BaiduNetdiskDownload/2025年高考化学试卷（山东卷）（解析卷）.docx")).then(async (zip) => {
  const xml = await zip.file("word/document.xml").async("string");
  const rels = await zip.file("word/_rels/document.xml.rels").async("string");

  // 关系映射
  const relMap = {};
  const relRe = /<Relationship\b([^>]*)>/g;
  let m;
  while ((m = relRe.exec(rels))) {
    const attrs = m[1];
    const id = (attrs.match(/Id="([^"]*)"/) || [])[1];
    const target = (attrs.match(/Target="([^"]*)"/) || [])[1];
    const external = /TargetMode="External"/.test(attrs);
    if (id) relMap[id] = { target, external };
  }
  console.log("关系总数:", Object.keys(relMap).length);

  // media 文件总大小
  let total = 0;
  const media = Object.keys(zip.files).filter((p) => p.startsWith("word/media/") && !zip.files[p].dir);
  media.forEach((p) => {
    total += zip.files[p]._data?.uncompressedSize || 0;
  });
  console.log("media 文件数:", media.length, "| 解压后总大小:", (total / 1024 / 1024).toFixed(2), "MB");
  console.log("base64 后约:", ((total * 4 / 3) / 1024 / 1024).toFixed(2), "MB");

  // 段落索引 -> 图片
  const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  const pictRe = /<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g;
  let pIndex = 0;
  let withImages = 0;
  let pictCount = 0;
  const samples = [];
  while ((m = pRe.exec(xml))) {
    const content = m[1];
    const picts = content.match(pictRe) || [];
    if (picts.length) {
      withImages += 1;
      pictCount += picts.length;
      if (samples.length < 5) samples.push({ pIndex, count: picts.length });
    }
    pIndex += 1;
  }
  console.log("含图片的段落数:", withImages, "| pict 总数:", pictCount);
  console.log("样例:", JSON.stringify(samples));
});
