// Word docx 通用读取：命名空间本地名、正文解析、图片关系。
// 题目解析（main.js）与原文预览（word-preview.js）共用这套逻辑。

export const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const VML_NS = "urn:schemas-microsoft-com:vml";
export const WORD_MAIN_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function localName(node) {
  return node?.localName || String(node?.nodeName || "").split(":").pop();
}

/** 把 document.xml.rels 里的相对路径换算成 zip 内的真实路径 */
export function zipPathForWordTarget(target) {
  const parts = (target.startsWith("/") ? target.slice(1) : `word/${target}`)
    .replaceAll("\\", "/")
    .split("/");
  const resolved = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

export function mimeTypeForImage(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      svg: "image/svg+xml",
      webp: "image/webp",
    }[extension] || "application/octet-stream"
  );
}

export function parseBody(xml) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Word 正文 XML 无法解析");

  const body = document.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("Word 文件中找不到正文");
  return body;
}

/** 读取图片关系表；文件不存在时返回 null，XML 损坏时抛错 */
export async function readRelationships(zip) {
  const file = zip.file("word/_rels/document.xml.rels");
  if (!file) return null;
  const xml = await file.async("string");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Word 图片关系 XML 无法解析");
  return new Map(
    Array.from(document.getElementsByTagNameNS("*", "Relationship"), (relationship) => [
      relationship.getAttribute("Id"),
      {
        target: relationship.getAttribute("Target"),
        external: relationship.getAttribute("TargetMode") === "External",
      },
    ]),
  );
}

/** 关系 ID → 图片 data URL，带缓存，同一张图只读一次 */
export function createImageLoader(zip, relationships) {
  const cache = new Map();
  return {
    async read(relationshipId) {
      if (!relationshipId) return null;
      if (cache.has(relationshipId)) return cache.get(relationshipId);
      const relationship = relationships?.get(relationshipId);
      if (!relationship || relationship.external) {
        cache.set(relationshipId, null);
        return null;
      }
      const path = zipPathForWordTarget(relationship.target);
      const file = zip.file(path);
      if (!file) {
        cache.set(relationshipId, null);
        return null;
      }
      const src = `data:${mimeTypeForImage(path)};base64,${await file.async("base64")}`;
      cache.set(relationshipId, src);
      return src;
    },
  };
}
