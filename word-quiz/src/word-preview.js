// 把 Word 正文渲染成可在网页里阅读的 HTML，用于导入后逐题校对原文。
// 段落按顺序输出并带上 data-question，便于按题号定位高亮。
import { escapeHtml } from "../../src/question-text.js";
import {
  REL_NS,
  createImageLoader,
  localName,
  parseBody,
  readRelationships,
} from "./word-docx.js";

const PAGE_NUMBER_LINE = /^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/;
const QUESTION_START = /^\s*(\d{1,2})\s*[.．、]\s*/;

function plainOf(html) {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function imageTag(id, loader, seen) {
  if (!id || seen.has(id)) return "";
  seen.add(id);
  const src = await loader.read(id);
  return src ? `<img class="doc-image" src="${escapeHtml(src)}" alt="Word 原文图片">` : "";
}

/** 收集节点里的图片（DrawingML 的 blip 与旧版 VML 的 imagedata），按段落去重 */
async function imageTags(node, loader, seen) {
  const ids = [
    ...Array.from(node.getElementsByTagNameNS("*", "blip"), (blip) => blip.getAttributeNS(REL_NS, "embed") || blip.getAttribute("r:embed")),
    ...Array.from(node.getElementsByTagNameNS("*", "imagedata"), (data) => data.getAttributeNS(REL_NS, "id") || data.getAttribute("r:id")),
  ];
  const tags = [];
  for (const id of ids) tags.push(await imageTag(id, loader, seen));
  return tags.join("");
}

async function childrenHtml(node, loader, seen) {
  const parts = [];
  for (const child of Array.from(node.childNodes)) {
    parts.push(await renderNode(child, loader, seen));
  }
  return parts.join("");
}

async function renderNode(node, loader, seen) {
  if (node.nodeType === Node.TEXT_NODE) {
    return localName(node.parentElement) === "t" ? escapeHtml(node.nodeValue) : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const name = localName(node);
  if (name === "t") return escapeHtml(node.textContent || "");
  if (name === "tab") return "&nbsp;&nbsp;&nbsp;&nbsp;";
  if (name === "br" || name === "cr") return "<br>";
  if (name === "imagedata") {
    return imageTag(node.getAttributeNS(REL_NS, "id") || node.getAttribute("r:id"), loader, seen);
  }
  if (name === "drawing" || name === "pict" || name === "object") {
    const tag = await imageTags(node, loader, seen);
    return tag || (await childrenHtml(node, loader, seen));
  }
  return childrenHtml(node, loader, seen);
}

async function renderParagraph(paragraph, loader, seen) {
  return childrenHtml(paragraph, loader, seen);
}

async function renderTable(table, loader, seen) {
  const rows = Array.from(table.children).filter((row) => localName(row) === "tr");
  const body = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter((cell) => localName(cell) === "tc");
    const cellHtml = [];
    for (const cell of cells) {
      const paragraphs = Array.from(cell.children).filter((child) => localName(child) === "p");
      const inner = [];
      for (const paragraph of paragraphs) {
        const html = await renderParagraph(paragraph, loader, seen);
        if (plainOf(html)) inner.push(html);
      }
      cellHtml.push(`<td>${inner.join("<br>")}</td>`);
    }
    body.push(`<tr>${cellHtml.join("")}</tr>`);
  }
  return `<table class="doc-table"><tbody>${body.join("")}</tbody></table>`;
}

/**
 * @param {Object} zip JSZip 实例
 * @param {String} xml word/document.xml 文本
 * @returns {Promise<{html: String}>} 原文预览 HTML
 */
export async function buildWordPreview(zip, xml) {
  const body = parseBody(xml);
  const relationships = await readRelationships(zip);
  const loader = createImageLoader(zip, relationships);

  const blocks = [];
  for (const [index, child] of Array.from(body.children).entries()) {
    const name = localName(child);
    const seen = new Set();

    if (name === "p") {
      const inner = await renderParagraph(child, loader, seen);
      const text = plainOf(inner);
      if (!text && !inner.includes("<img")) continue;
      if (PAGE_NUMBER_LINE.test(text)) continue;
      const question = text.match(QUESTION_START);
      const attrs = [
        'class="doc-block"',
        `data-index="${index}"`,
        question ? `data-question="${Number(question[1])}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      blocks.push(`<p ${attrs}>${inner}</p>`);
      continue;
    }

    if (name === "tbl") {
      const html = await renderTable(child, loader, seen);
      blocks.push(`<div class="doc-block" data-index="${index}">${html}</div>`);
    }
  }

  return { html: blocks.join("") };
}
