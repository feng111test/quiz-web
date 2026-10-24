import JSZip from "jszip";
import "./styles.css";
import {
  deleteBank as removeBank,
  ensurePersistence,
  formatSavedAt,
  listBanks,
  saveBank,
} from "../../src/question-bank.js";
import { downloadBankFile, readBankFile, toWordQuestions } from "../../src/bank-file.js";
import {
  FORMULA_TOKEN,
  escapeHtml,
  renderFormulaContent,
} from "../../src/question-text.js";
import { parseQuestionBank } from "./word-parser.js";
import { buildWordPreview } from "./word-preview.js";
import {
  REL_NS,
  VML_NS,
  WORD_MAIN_NS,
  createImageLoader,
  localName,
  readRelationships,
} from "./word-docx.js";
import { assignFormulaImages, matchQuestionSourceTable } from "./word-images.js";

document.documentElement.classList.toggle("embedded", new URLSearchParams(location.search).has("embedded"));

const byId = (id) => document.getElementById(id);
const ui = {
  input: byId("word-input"),
  welcome: byId("welcome"),
  workspace: byId("workspace"),
  fileName: byId("file-name"),
  fileMeta: byId("file-meta"),
  bankName: byId("bank-name"),
  listCount: byId("list-count"),
  questionList: byId("question-list"),
  skippedNote: byId("skipped-note"),
  progressText: byId("progress-text"),
  answeredText: byId("answered-text"),
  correctText: byId("correct-text"),
  accuracyText: byId("accuracy-text"),
  progressBar: byId("progress-bar"),
  number: byId("question-number"),
  type: byId("question-type"),
  title: byId("question-title"),
  sourceTable: byId("source-table"),
  options: byId("answer-options"),
  feedback: byId("feedback"),
  previous: byId("prev-button"),
  next: byId("next-button"),
  submit: byId("submit-button"),
  restart: byId("restart-button"),
  proofreadButton: byId("proofread-button"),
  proofread: byId("proofread"),
  proofHeading: byId("proof-heading"),
  proofIndex: byId("proof-index"),
  proofPrev: byId("proof-prev"),
  proofNext: byId("proof-next"),
  proofExit: byId("proof-exit"),
  proofType: byId("proof-type"),
  proofStem: byId("proof-stem"),
  proofOptionsField: byId("proof-options-field"),
  proofOptions: byId("proof-options"),
  proofAddOption: byId("proof-add-option"),
  proofAnswerField: byId("proof-answer-field"),
  proofAnswerText: byId("proof-answer-text"),
  proofExplanation: byId("proof-explanation"),
  proofImages: byId("proof-images"),
  proofSave: byId("proof-save"),
  proofRevert: byId("proof-revert"),
  proofStatus: byId("proof-status"),
  docBody: byId("doc-body"),
  docMissing: byId("doc-missing"),
  docHint: byId("doc-hint"),
  docLocate: byId("doc-locate"),
  docScope: byId("doc-scope"),
  deleteBank: byId("delete-bank"),
  bankLibrary: byId("bankLibrary"),
  bankCount: byId("bankCount"),
  bankList: byId("bankList"),
  bankStatusTitle: byId("bankStatusTitle"),
  bankStatusNote: byId("bankStatusNote"),
  exportBank: byId("export-bank"),
  bankInput: byId("bank-input"),
  toast: byId("toast"),
};

const state = {
  questions: [],
  current: 0,
  responses: new Map(),
  toastTimer: null,
  bankId: null,
  bankName: "",
  saveTimer: null,
  proofreading: false,
  documentHtml: "",
  documentName: "",
  // 原文预览按段落切块，默认只渲染本题所在片段，避免整篇 Word 撑长页面
  docBlocks: [],
  docFull: false,
  // 校对前的解析结果快照，用于「恢复解析结果」
  originals: new Map(),
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FORMULA_SPACING_MIN = 150;
const FORMULA_SPACING_MAX = 1100;
const FORMULA_IMAGE_ROW_TOLERANCE = 3;
const TYPE_LABELS = { single: "单选题", multiple: "多选题", subjective: "主观题" };
const OPTION_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// 原文里定位不到本题时，最多展示的段落数
const DOC_FALLBACK_BLOCKS = 24;
const FORMULA_PLACEHOLDER = "〔公式〕";
const EMU_PER_POINT = 12700;

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 3200);
}

function formulaPlaceholder(run) {
  const properties = Array.from(run.children).find((child) => localName(child) === "rPr");
  const spacing = Array.from(properties?.children || []).find((child) => localName(child) === "spacing");
  if (!spacing) return false;

  const value = Number(spacing.getAttributeNS(WORD_MAIN_NS, "val"));
  const isFormulaSpacing =
    (value >= FORMULA_SPACING_MIN && value <= FORMULA_SPACING_MAX) || value >= 4000;
  if (!isFormulaSpacing) return false;

  const text = Array.from(run.getElementsByTagNameNS("*", "t"), (item) => item.textContent).join("");
  return !text.trim();
}

function nodeText(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return ["t"].includes(localName(node.parentElement)) ? node.nodeValue : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const name = localName(node);
  if (name === "r" && formulaPlaceholder(node)) return FORMULA_TOKEN;
  if (name === "tab") return " ";
  if (name === "br" || name === "cr") return "\n";
  return Array.from(node.childNodes, nodeText).join("");
}

function paragraphText(paragraph) {
  return nodeText(paragraph).replace(/\u00a0/g, " ").trim();
}

function tableLines(table) {
  return Array.from(table.children)
    .filter((row) => localName(row) === "tr")
    .map((row) => {
      const cells = Array.from(row.children)
        .filter((cell) => localName(cell) === "tc")
        .map((cell) =>
          Array.from(cell.children)
            .filter((paragraph) => localName(paragraph) === "p")
            .map(paragraphText)
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean);
      return cells.join("    ");
    })
    .filter(Boolean);
}

function extractDocumentText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Word 正文 XML 无法解析");

  const body = doc.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("Word 文件中找不到正文");

  const lines = [];
  for (const child of body.children) {
    const name = localName(child);
    if (name === "p") {
      const text = paragraphText(child);
      if (text && !/^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/.test(text)) lines.push(text);
    } else if (name === "tbl") {
      lines.push(...tableLines(child));
    }
  }
  return lines.join("\n");
}

function questionParagraphIndexes(xml) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Word 正文 XML 无法解析");

  const body = document.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("Word 文件中找不到正文");

  const indexes = new Map();
  Array.from(body.children).forEach((child, index) => {
    if (localName(child) !== "p") return;
    const match = paragraphText(child).match(/^\s*(\d{1,2})\s*[.．、]\s*/);
    if (match) indexes.set(Number(match[1]), index);
  });
  return { indexes, paragraphCount: body.children.length };
}

function styleLength(style, property) {
  const value = style.match(new RegExp(`${property}:([0-9.]+)pt`))?.[1];
  return value ? Number(value) : 0;
}

function emuToPoints(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number / EMU_PER_POINT : 0;
}

async function extractFormulaImagePages(zip, documentXmlText) {
  const document = new DOMParser().parseFromString(documentXmlText, "application/xml");
  const hasVml = document.getElementsByTagNameNS(VML_NS, "shape").length > 0;
  const hasDrawing = document.getElementsByTagNameNS("*", "drawing").length > 0;
  if (!hasVml && !hasDrawing) return { pages: [], unresolvedImages: 0 };

  const relationships = await readRelationships(zip);
  if (!relationships) throw new Error("Word 中包含公式图片，但找不到图片关系文件");

  const body = document.getElementsByTagNameNS("*", "body")[0];
  if (!body) return { pages: [], unresolvedImages: 0 };
  const pages = [];
  const { read: readImage } = createImageLoader(zip, relationships);
  let unresolvedImages = 0;

  for (const [paragraphIndex, paragraph] of Array.from(body.children).entries()) {
    if (localName(paragraph) !== "p") continue;

    const images = [];
    const pushImage = (image) => {
      // 同一张图可能同时以 VML 与 DrawingML 出现（mc:AlternateContent），按位置近似去重
      const duplicate = images.some(
        (item) =>
          item.src === image.src &&
          Math.abs(item.x - image.x) <= 6 &&
          Math.abs(item.y - image.y) <= 4,
      );
      if (duplicate) return;
      images.push(image);
    };

    // 旧版 VML 浮动公式图
    for (const shape of Array.from(paragraph.getElementsByTagNameNS(VML_NS, "shape"))) {
      const style = shape.getAttribute("style");
      const width = styleLength(style, "width");
      const height = styleLength(style, "height");
      if (width < 6 || height < 6) continue;

      const imageData = shape.getElementsByTagNameNS("*", "imagedata")[0];
      const relationshipId = imageData?.getAttributeNS(REL_NS, "id") || imageData?.getAttribute("r:id");
      const src = await readImage(relationshipId);
      if (!src) {
        unresolvedImages += 1;
        continue;
      }
      pushImage({
        x: styleLength(style, "margin-left"),
        y: styleLength(style, "margin-top"),
        width,
        height,
        src,
      });
    }

    // 新版 DrawingML 图片（Word 公式也可能以这种形式保存）
    for (const drawing of Array.from(paragraph.getElementsByTagNameNS("*", "drawing"))) {
      const blip = drawing.getElementsByTagNameNS("*", "blip")[0];
      if (!blip) continue;
      const relationshipId = blip.getAttributeNS(REL_NS, "embed") || blip.getAttribute("r:embed");
      const src = await readImage(relationshipId);
      if (!src) {
        unresolvedImages += 1;
        continue;
      }

      const extent = drawing.getElementsByTagNameNS("*", "extent")[0];
      let width = extent ? emuToPoints(extent.getAttribute("cx")) : 0;
      let height = extent ? emuToPoints(extent.getAttribute("cy")) : 0;
      if (!width || !height) {
        const shapeExtent = drawing.getElementsByTagNameNS("*", "ext")[0];
        width = width || emuToPoints(shapeExtent?.getAttribute("cx"));
        height = height || emuToPoints(shapeExtent?.getAttribute("cy"));
      }
      if (width < 6 || height < 6) continue;

      const positionH = drawing.getElementsByTagNameNS("*", "positionH")[0];
      const positionV = drawing.getElementsByTagNameNS("*", "positionV")[0];
      const offsetH = positionH?.getElementsByTagNameNS("*", "posOffset")[0];
      const offsetV = positionV?.getElementsByTagNameNS("*", "posOffset")[0];
      pushImage({
        x: emuToPoints(offsetH?.textContent),
        y: emuToPoints(offsetV?.textContent),
        width,
        height,
        src,
      });
    }

    if (!images.length) continue;

    const rows = [];
    for (const image of images.sort((left, right) => left.y - right.y || left.x - right.x)) {
      let row = rows.at(-1);
      if (!row || Math.abs(row.y - image.y) > FORMULA_IMAGE_ROW_TOLERANCE) {
        row = { y: image.y, images: [] };
        rows.push(row);
      }
      row.images.push(image);
    }
    if (rows.length) pages.push({ paragraphIndex, rows });
  }

  return { pages, unresolvedImages };
}

async function loadWord(file) {
  if (!file.name.toLowerCase().endsWith(".docx") && file.type !== WORD_MIME) {
    throw new Error("请选择 .docx Word 文件；旧版 .doc 格式不支持");
  }
  if (file.size > MAX_FILE_SIZE) throw new Error("Word 文件不能超过 50 MB");

  const zip = await JSZip.loadAsync(file);
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) throw new Error("文件中找不到 Word 正文，请确认是有效的 .docx 文件");
  if (documentXml._data?.uncompressedSize > MAX_FILE_SIZE * 4) {
    throw new Error("Word 正文过大，无法安全解析");
  }

  const xml = await documentXml.async("string");
  const result = parseQuestionBank(extractDocumentText(xml));
  const paragraphIndexes = questionParagraphIndexes(xml);
  const { pages, unresolvedImages } = await extractFormulaImagePages(zip, xml);

  // 仪器/实验表格是按尺寸匹配的大图，先单独挑出来，避免被当成公式图片
  let tableCursor = { page: 0, row: 0 };
  for (const question of result.questions) {
    const match = matchQuestionSourceTable(question, pages, tableCursor);
    if (match) tableCursor = match;
  }

  // 公式图片：按题号所在页 + 顺序游标，依次填入题干 / 选项 / 答案 / 解析
  assignFormulaImages(result.questions, pages, paragraphIndexes.indexes, paragraphIndexes.paragraphCount);

  // 原文预览：校对时左侧按段落取用，默认只展示本题所在片段
  let documentHtml = "";
  try {
    const preview = await buildWordPreview(zip, xml);
    documentHtml = preview.html;
  } catch (error) {
    console.warn("[Word 原文预览] 生成失败", error);
  }

  return { ...result, unresolvedImages, documentHtml, documentName: file.name };
}

function currentQuestion() {
  return state.questions[state.current];
}

function responseFor(question) {
  if (!state.responses.has(question.id)) {
    state.responses.set(question.id, { selected: [], text: "", submitted: false, correct: null });
  }
  return state.responses.get(question.id);
}

function sameAnswer(left, right) {
  return left.length === right.length && [...left].sort().every((key, index) => key === [...right].sort()[index]);
}

/** 主观题的参考答案：Word 解析结果用 answerText，导入的题库用 answer 数组 */
function referenceAnswerText(question) {
  if (typeof question.answerText === "string" && question.answerText.trim()) {
    return question.answerText.trim();
  }
  return (question.answer || [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join("、");
}

function responseState(response) {
  if (!response.submitted) return "";
  if (response.correct === true) return "correct";
  if (response.correct === false) return "wrong";
  return "pending";
}

function renderList() {
  ui.questionList.innerHTML = state.questions
    .map((question, index) => {
      const response = responseFor(question);
      const status = responseState(response);
      const mark = !response.submitted ? "" : response.correct === true ? "✓" : response.correct === false ? "✗" : "?";
      return `<button class="list-item ${index === state.current ? "active" : ""} ${status} ${question.reviewed ? "reviewed" : ""}" data-index="${index}" type="button" title="${question.reviewed ? "已校对" : ""}">
        <span class="list-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="list-title">${renderFormulaContent(question.title, question.titleImages, FORMULA_PLACEHOLDER)}</span>
        <span class="list-mark">${mark}</span>
      </button>`;
    })
    .join("");

  ui.questionList.querySelectorAll(".list-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = Number(button.dataset.index);
      render();
    });
  });
}

function renderOptions(question, response) {
  const isSubmitted = response.submitted;
  if (question.type === "subjective") {
    ui.options.innerHTML = `<div class="subjective-answer">
      <textarea class="subjective-input" rows="6" placeholder="在这里作答（填空题 / 解答题）" ${isSubmitted ? "disabled" : ""}>${escapeHtml(response.text || "")}</textarea>
    </div>`;
    const input = ui.options.querySelector(".subjective-input");
    if (input && !isSubmitted) {
      input.addEventListener("input", () => {
        response.text = input.value;
      });
    }
    return;
  }
  ui.options.innerHTML = question.options
    .map((option) => {
      const selected = response.selected.includes(option.key);
      const correct = question.answer.includes(option.key);
      const optionClass = [
        "answer-option",
        selected ? "selected" : "",
        isSubmitted && correct ? "is-correct" : "",
        isSubmitted && selected && !correct ? "is-wrong" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<label class="${optionClass}">
        <input type="${question.type === "multiple" ? "checkbox" : "radio"}" name="answer" value="${option.key}" ${selected ? "checked" : ""} ${isSubmitted ? "disabled" : ""}>
        <span class="option-key">${option.key}</span>
        <span class="option-content">${renderFormulaContent(option.content, option.formulaImages, FORMULA_PLACEHOLDER)}</span>
        ${isSubmitted && correct ? '<span class="option-mark">正确答案</span>' : ""}
      </label>`;
    })
    .join("");

  ui.options.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (question.type === "multiple") {
        const selected = new Set(response.selected);
        if (input.checked) selected.add(input.value);
        else selected.delete(input.value);
        response.selected = [...selected].sort();
      } else {
        response.selected = [input.value];
      }
      ui.options.querySelectorAll(".answer-option").forEach((option) => {
        option.classList.toggle("selected", option.querySelector("input").checked);
      });
    });
  });
}

function explanationHtml(question) {
  const gallery = question.explanationImages?.length
    ? `<div class="formula-source"><strong>Word 原文公式图片</strong><div class="formula-gallery">${question.explanationImages
        .map(
          (image, index) =>
            `<img class="formula-image" src="${escapeHtml(image.src)}" alt="Word 原文公式 ${index + 1}">`,
        )
        .join("")}</div></div>`
    : "";
  if (!question.explanation) {
    return `<div class="feedback-explanation"><p>文档未提供解析。</p></div>`;
  }
  return `<div class="feedback-explanation"><strong>解析</strong><p>${renderFormulaContent(
    question.explanation,
    [],
    question.explanationImages?.length ? "原文公式见下方" : FORMULA_PLACEHOLDER,
  )}</p>${gallery}</div>`;
}

function renderFeedback(question, response) {
  if (!response.submitted) {
    ui.feedback.hidden = true;
    ui.feedback.className = "feedback";
    ui.feedback.innerHTML = "";
    return;
  }

  if (question.type === "subjective") {
    const reference = referenceAnswerText(question);
    const graded = response.correct === true || response.correct === false;
    ui.feedback.hidden = false;
    ui.feedback.className = `feedback ${
      graded ? (response.correct ? "feedback-correct" : "feedback-wrong") : "feedback-pending"
    }`;
    ui.feedback.innerHTML = `
      <div class="feedback-heading">${
        graded ? (response.correct ? "已标记为答对" : "已标记为答错") : "已提交，请对照参考答案自评"
      }</div>
      <div class="feedback-answer">参考答案：<div class="reference-text">${
        reference
          ? renderFormulaContent(reference, question.answerTextImages || [], FORMULA_PLACEHOLDER)
          : "文档未提供参考答案"
      }</div></div>
      ${explanationHtml(question)}
      <div class="self-grade"><span>你答对了吗？</span><button type="button" class="button button-quiet" data-grade="correct">答对了</button><button type="button" class="button button-quiet" data-grade="wrong">答错了</button></div>`;
    ui.feedback.querySelectorAll("[data-grade]").forEach((button) => {
      button.addEventListener("click", () => {
        response.correct = button.dataset.grade === "correct";
        render();
        schedulePersist();
      });
    });
    return;
  }

  const answer = (question.answer || []).join("、");
  ui.feedback.hidden = false;
  ui.feedback.className = `feedback ${response.correct === true ? "feedback-correct" : "feedback-wrong"}`;
  ui.feedback.innerHTML = `
    <div class="feedback-heading">${response.correct === true ? "回答正确" : "再接再厉"}</div>
    <div class="feedback-answer">正确答案：<strong>${escapeHtml(answer)}</strong></div>
    ${explanationHtml(question)}`;
}

function renderStats() {
  const total = state.questions.length;
  const answered = [...state.responses.values()].filter((response) => response.submitted).length;
  const correct = [...state.responses.values()].filter((response) => response.submitted && response.correct === true).length;
  const percent = answered ? Math.round((correct / answered) * 100) : 0;
  ui.progressText.textContent = `${state.current + 1} / ${total}`;
  ui.answeredText.textContent = String(answered);
  ui.correctText.textContent = String(correct);
  ui.accuracyText.textContent = answered ? `${percent}%` : "—";
  ui.progressBar.style.width = `${total ? ((state.current + 1) / total) * 100 : 0}%`;
}

function render() {
  const question = currentQuestion();
  if (!question) return;
  const response = responseFor(question);

  ui.number.textContent = `第 ${state.current + 1} 题`;
  ui.type.textContent = TYPE_LABELS[question.type] || "单选题";
  ui.title.innerHTML = renderFormulaContent(question.title, question.titleImages, FORMULA_PLACEHOLDER);
  ui.sourceTable.hidden = !question.sourceTable;
  ui.sourceTable.innerHTML = question.tableImage
    ? `<figcaption>Word 原文表格图片（含公式）</figcaption><img src="${escapeHtml(question.tableImage.src)}" alt="Word 原文表格及其中的公式">`
    : question.sourceTable
      ? "<figcaption>原文表格图片未能匹配，请核对 Word 原文。</figcaption>"
      : "";
  ui.previous.disabled = state.current === 0;
  ui.next.disabled = state.current === state.questions.length - 1;
  ui.submit.hidden = response.submitted;

  renderOptions(question, response);
  renderFeedback(question, response);
  renderStats();
  renderList();
}

/* ---------------- 校对：左侧原文 Word，右侧解析结果 ---------------- */

function setProofreading(on) {
  const active = Boolean(on) && state.questions.length > 0;
  if (!active) {
    state.proofreading = false;
    ui.proofread.hidden = true;
    ui.workspace.hidden = false;
    return;
  }
  state.proofreading = true;
  ui.proofread.hidden = false;
  ui.workspace.hidden = true;
  if (!state.documentHtml) {
    showToast("本机题库不含原始 Word 文件，可重新导入同一份文档查看原文");
  }
  renderDocPreview();
  renderProofread();
}

/** 原文 HTML 只解析一次，之后按段落块取用 */
function setDocumentHtml(html, name = "") {
  state.documentHtml = html || "";
  state.documentName = name || "";
  state.docBlocks = state.documentHtml ? parseDocBlocks(state.documentHtml) : [];
}

function parseDocBlocks(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return Array.from(host.querySelectorAll(".doc-block")).map((block) => ({
    html: block.outerHTML,
    question: Number(block.dataset.question || 0),
    text: block.textContent.replace(/\s+/g, ""),
  }));
}

/** 找到本题在原文里的起始段落下标，-1 表示没找到 */
function findQuestionBlock(question) {
  if (!question || !state.docBlocks.length) return -1;
  const number = Number(question.number);
  if (number > 0) {
    const byNumber = state.docBlocks.findIndex((block) => block.question === number);
    if (byNumber >= 0) return byNumber;
  }
  const key = String(question.title || "").replace(/\s+/g, "").slice(0, 10);
  if (!key) return -1;
  return state.docBlocks.findIndex((block) => block.text.includes(key));
}

function renderDocPreview() {
  ui.docBody.hidden = !state.documentHtml;
  ui.docMissing.hidden = Boolean(state.documentHtml);
  ui.docLocate.hidden = !state.documentHtml;
  ui.docScope.hidden = !state.documentHtml;
  ui.docScope.textContent = state.docFull ? "全文" : "仅看本题";
  ui.docScope.classList.toggle("on", state.docFull);
  ui.docHint.textContent = state.documentName || "对照原文核对解析结果";
  renderDocScope();
}

/**
 * 左侧只渲染当前需要的原文片段：默认本题起止的段落，切到「全文」才渲染整篇，
 * 预览区自身固定高度内滚动，页面不会被 Word 内容撑长。
 */
function renderDocScope() {
  if (!state.documentHtml) return;
  if (!state.docBlocks.length) state.docBlocks = parseDocBlocks(state.documentHtml);

  const question = currentQuestion();
  const found = findQuestionBlock(question);
  let start = 0;
  let end = Math.min(state.docBlocks.length, DOC_FALLBACK_BLOCKS);
  if (state.docFull) {
    end = state.docBlocks.length;
  } else if (found >= 0) {
    start = found;
    end = found + 1;
    // 一直取到下一题开头之前，把选项和解析一起带上
    while (end < state.docBlocks.length && !state.docBlocks[end].question) end += 1;
  }

  ui.docBody.innerHTML = state.docBlocks.slice(start, end).map((block) => block.html).join("");
  ui.docBody.scrollTop = 0;

  const rendered = Array.from(ui.docBody.querySelectorAll(".doc-block"));
  const active = found >= start && found < end ? rendered[found - start] : null;
  if (active) {
    active.classList.add("active");
    ui.docBody.scrollTop = Math.max(0, active.offsetTop - 12);
    ui.docHint.textContent = `已定位第 ${Number(question?.number) || state.current + 1} 题`;
    return;
  }
  ui.docHint.textContent = state.docFull ? "请手动滚动查找本题原文" : "原文中未能定位到本题，可切换「全文」查找";
}

function proofOptionRow(option, checked) {
  return `<div class="proof-option">
    <input class="proof-option-key" type="text" value="${escapeHtml(option.key)}" aria-label="选项标号" />
    <textarea class="proof-option-content" rows="2" aria-label="选项内容">${escapeHtml(option.content)}</textarea>
    <label class="proof-option-right"><input class="proof-option-answer" type="checkbox" ${checked ? "checked" : ""} />正确</label>
    <button class="proof-option-remove" type="button">删除</button>
  </div>`;
}

function wireOptionRemove(row) {
  row.querySelector(".proof-option-remove")?.addEventListener("click", () => row.remove());
}

function renderProofOptions(question) {
  const answers = question.answer || [];
  ui.proofOptions.innerHTML = (question.options || [])
    .map((option) => proofOptionRow(option, answers.includes(option.key)))
    .join("");
  ui.proofOptions.querySelectorAll(".proof-option").forEach(wireOptionRemove);
}

function addProofOption() {
  const index = ui.proofOptions.querySelectorAll(".proof-option").length;
  const row = document.createElement("div");
  row.className = "proof-option";
  row.innerHTML = `<input class="proof-option-key" type="text" value="${OPTION_KEYS[index] || ""}" aria-label="选项标号" />
    <textarea class="proof-option-content" rows="2" aria-label="选项内容"></textarea>
    <label class="proof-option-right"><input class="proof-option-answer" type="checkbox" />正确</label>
    <button class="proof-option-remove" type="button">删除</button>`;
  wireOptionRemove(row);
  ui.proofOptions.append(row);
  row.querySelector(".proof-option-content").focus();
}

function syncProofFields() {
  const subjective = ui.proofType.value === "subjective";
  ui.proofOptionsField.hidden = subjective;
  ui.proofAnswerField.hidden = !subjective;
}

function renderProofImages(question) {
  const items = [...(question.images || []), ...(question.titleImages || [])]
    .map((image, index) => ({ label: `题干图片 ${index + 1}`, src: image.src || image.dataUrl || "" }))
    .concat(
      (question.explanationImages || []).map((image, index) => ({
        label: `解析图片 ${index + 1}`,
        src: image.src || image.dataUrl || "",
      })),
    );
  if (question.tableImage) {
    items.push({ label: "原文表格", src: question.tableImage.src || question.tableImage.dataUrl || "" });
  }
  ui.proofImages.innerHTML = items.length
    ? items
        .filter((item) => item.src.startsWith("data:"))
        .map(
          (item) =>
            `<figure class="proof-image"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.label)}"><figcaption>${escapeHtml(item.label)}</figcaption></figure>`,
        )
        .join("")
    : '<span class="proof-images-empty">本题没有解析到原文图片</span>';
}

function renderProofStatus(question) {
  ui.proofStatus.textContent = question.reviewed ? "已校对" : "待校对";
  ui.proofStatus.classList.toggle("done", Boolean(question.reviewed));
}

function renderProofread() {
  const question = currentQuestion();
  if (!question) return;
  const reviewed = state.questions.filter((item) => item.reviewed).length;
  ui.proofHeading.textContent = `解析结果校对 · 已校对 ${reviewed}/${state.questions.length}`;
  ui.proofIndex.textContent = `${state.current + 1} / ${state.questions.length}`;
  ui.proofType.value =
    question.type === "subjective" ? "subjective" : question.type === "multiple" ? "multiple" : "single";
  ui.proofStem.value = question.title || "";
  ui.proofExplanation.value = question.explanation || "";
  ui.proofAnswerText.value = referenceAnswerText(question);
  ui.proofPrev.disabled = state.current === 0;
  ui.proofNext.disabled = state.current === state.questions.length - 1;
  renderProofOptions(question);
  renderProofImages(question);
  renderProofStatus(question);
  syncProofFields();
  renderDocScope();
}

function readProofForm() {
  const rows = Array.from(ui.proofOptions.querySelectorAll(".proof-option"));
  const options = [];
  const answer = [];
  rows.forEach((row) => {
    const key = row.querySelector(".proof-option-key").value.trim();
    const content = row.querySelector(".proof-option-content").value.trim();
    if (!key && !content) return;
    const finalKey = key || OPTION_KEYS[options.length] || `选项${options.length + 1}`;
    options.push({ key: finalKey, content });
    if (row.querySelector(".proof-option-answer").checked) answer.push(finalKey);
  });
  return {
    type: ui.proofType.value,
    title: ui.proofStem.value.trim(),
    answerText: ui.proofAnswerText.value.trim(),
    explanation: ui.proofExplanation.value.trim(),
    options,
    answer: [...new Set(answer)],
  };
}

/** 表单内容与题目不一致时提示，避免改了一半就翻页丢失 */
function proofDirty() {
  const question = currentQuestion();
  if (!question) return false;
  const form = readProofForm();
  if (form.type !== question.type) return true;
  if (form.title !== (question.title || "")) return true;
  if (form.explanation !== (question.explanation || "")) return true;
  if (form.type === "subjective") return form.answerText !== referenceAnswerText(question);
  const source = question.options || [];
  return (
    [...form.answer].sort().join(",") !== [...(question.answer || [])].sort().join(",") ||
    form.options.length !== source.length ||
    form.options.some(
      (option, index) => !source[index] || option.key !== source[index].key || option.content !== source[index].content,
    )
  );
}

function switchProofQuestion(next) {
  if (proofDirty() && !window.confirm("当前题目的修改还没保存，确定放弃吗？")) return;
  next();
}

function snapshotQuestion(question) {
  return {
    type: question.type,
    title: question.title,
    options: (question.options || []).map((option) => ({ ...option })),
    answer: [...(question.answer || [])],
    answerText: referenceAnswerText(question),
    explanation: question.explanation,
  };
}

function saveProofread() {
  const question = currentQuestion();
  if (!question) return;
  const form = readProofForm();
  if (!form.title) {
    showToast("题干不能为空");
    return;
  }
  if (form.type === "subjective") {
    if (!form.answerText) {
      showToast("请填写主观题参考答案");
      return;
    }
  } else {
    if (form.options.length < 2) {
      showToast("至少保留两个选项");
      return;
    }
    if (!form.answer.length) {
      showToast("请勾选正确答案");
      return;
    }
  }

  if (!state.originals.has(question.id)) {
    state.originals.set(question.id, snapshotQuestion(question));
  }
  // 选项里可能带公式图片，按选项标号保留下来
  const formulaImages = new Map((question.options || []).map((option) => [option.key, option.formulaImages || []]));
  question.type = form.type;
  question.title = form.title;
  question.explanation = form.explanation;
  question.reviewed = true;
  if (form.type === "subjective") {
    question.options = [];
    question.answer = [];
    question.answerText = form.answerText;
  } else {
    question.options = form.options.map((option) => ({
      ...option,
      formulaImages: formulaImages.get(option.key) || [],
    }));
    question.answer = form.answer;
    question.answerText = "";
  }

  // 已作答的客观题按校对后的答案重新判分
  const response = state.responses.get(question.id);
  if (response?.submitted && question.type !== "subjective") {
    response.correct = sameAnswer(response.selected, question.answer);
  }

  renderProofread();
  render();
  schedulePersist();
  showToast("已保存校对结果");
}

function revertProofread() {
  const question = currentQuestion();
  const source = question ? state.originals.get(question.id) : null;
  if (!source) {
    showToast("这道题还是解析后的原始内容");
    return;
  }
  question.type = source.type;
  question.title = source.title;
  question.options = source.options.map((option) => ({ ...option }));
  question.answer = [...source.answer];
  question.answerText = source.answerText;
  question.explanation = source.explanation;
  question.reviewed = false;
  state.originals.delete(question.id);
  renderProofread();
  render();
  schedulePersist();
  showToast("已恢复解析结果");
}

function renderBankStatus(timestamp) {
  ui.bankStatusTitle.textContent = "已保存到题库";
  ui.bankStatusNote.textContent = timestamp
    ? `已保存 · ${formatSavedAt(timestamp)} · 下次打开无需重新解析`
    : "下次打开可直接在「我的题库」中继续练习。";
}

async function persistBank() {
  if (!state.questions.length) return;
  const banks = await listBanks();
  const name = state.bankName || "未命名题库";
  const existing = state.bankId
    ? banks.find((bank) => bank.id === state.bankId)
    : banks.find((bank) => bank.source === "word" && bank.name === name);
  try {
    const saved = await saveBank({
      id: existing?.id,
      name,
      source: "word",
      fileName: ui.fileName.textContent || "",
      questions: state.questions,
      progress: {
        responses: Object.fromEntries(state.responses),
        current: state.current,
      },
    });
    state.bankId = saved.id;
    renderBankStatus(saved.updatedAt);
  } catch (error) {
    console.error("[题库] 保存失败", error);
    renderBankStatus(0);
    showToast("题库保存失败，请检查浏览器存储空间");
  }
  await renderBankLibrary();
}

function schedulePersist() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistBank, 700);
}

async function renderBankLibrary() {
  const banks = (await listBanks()).filter((bank) => bank.source === "word");
  ui.bankCount.textContent = String(banks.length);
  ui.bankLibrary.hidden = banks.length === 0;
  ui.bankList.innerHTML = banks
    .map(
      (bank) => `<div class="bank-item">
        <button class="bank-item-open" type="button" data-id="${escapeHtml(bank.id)}">
          <span class="bank-item-main">
            <strong>${escapeHtml(bank.name)}</strong>
            <small>${bank.questionCount} 题 · 保存于 ${escapeHtml(formatSavedAt(bank.updatedAt))}</small>
          </span>
        </button>
        <button class="bank-item-delete" type="button" data-id="${escapeHtml(bank.id)}" aria-label="删除题库 ${escapeHtml(bank.name)}">删除</button>
      </div>`,
    )
    .join("");

  ui.bankList.querySelectorAll(".bank-item-open").forEach((button) => {
    button.addEventListener("click", () => openBank(button.dataset.id));
  });
  ui.bankList.querySelectorAll(".bank-item-delete").forEach((button) => {
    button.addEventListener("click", () => removeBankById(button.dataset.id, banks));
  });
}

async function removeBankById(id, knownBanks) {
  const banks = knownBanks?.length ? knownBanks : await listBanks();
  const bank = banks.find((item) => item.id === id);
  if (!window.confirm(`确定删除题库「${bank?.name || ""}」吗？删除后无法恢复。`)) return;
  await removeBank(id);
  if (state.bankId === id) resetWorkspace();
  await renderBankLibrary();
  showToast("题库已删除");
}

async function openBank(id) {
  const banks = await listBanks();
  const bank = banks.find((item) => item.id === id);
  if (!bank?.questions?.length) {
    showToast("题库不存在或已损坏");
    await renderBankLibrary();
    return;
  }
  state.bankId = bank.id;
  state.bankName = bank.name;
  state.questions = bank.questions;
  state.responses.clear();
  Object.entries(bank.progress?.responses || {}).forEach(([key, value]) => {
    if (state.questions.some((question) => question.id === key)) state.responses.set(key, value);
  });
  const savedIndex = Number(bank.progress?.current || 0);
  state.current = Math.min(Math.max(savedIndex, 0), state.questions.length - 1);
  // 本机题库只存题目，原始 Word 需要重新导入才能显示原文
  setDocumentHtml("");
  state.originals.clear();
  setProofreading(false);
  ui.fileName.textContent = bank.fileName || `${bank.name}.docx`;
  ui.fileMeta.textContent = `${state.questions.length} 道题目 · 来自本机题库`;
  ui.bankName.textContent = bank.name;
  ui.listCount.textContent = String(state.questions.length);
  ui.skippedNote.hidden = true;
  ui.skippedNote.textContent = "";
  ui.welcome.hidden = true;
  ui.workspace.hidden = false;
  render();
  renderBankStatus(bank.updatedAt);
  showToast(`已打开题库「${bank.name}」，无需重新解析`);
}

function resetWorkspace() {
  clearTimeout(state.saveTimer);
  state.bankId = null;
  state.bankName = "";
  state.questions = [];
  state.current = 0;
  state.responses.clear();
  setDocumentHtml("");
  state.originals.clear();
  state.proofreading = false;
  ui.proofread.hidden = true;
  ui.welcome.hidden = false;
  ui.workspace.hidden = true;
}

async function importBankFile(file) {
  const bank = await readBankFile(file);
  state.bankId = null;
  state.bankName = bank.name;
  state.questions = toWordQuestions(bank.questions);
  state.responses.clear();
  state.current = 0;
  setDocumentHtml("");
  state.originals.clear();
  setProofreading(false);
  ui.fileName.textContent = `${bank.name}.json`;
  ui.fileMeta.textContent = `${state.questions.length} 道题目 · 来自导入的题库文件`;
  ui.bankName.textContent = bank.name;
  ui.listCount.textContent = String(state.questions.length);
  ui.skippedNote.hidden = true;
  ui.skippedNote.textContent = "";
  ui.welcome.hidden = true;
  ui.workspace.hidden = false;
  render();
  await persistBank();
  showToast(`已导入 ${state.questions.length} 道题`);
}

async function startQuiz(file, result) {
  state.bankName = file.name.replace(/\.docx$/i, "");
  state.questions = result.questions;
  const saved = (await listBanks()).find((bank) => bank.source === "word" && bank.name === state.bankName);
  state.bankId = saved?.id || null;
  setDocumentHtml(result.documentHtml, result.documentName || file.name);
  state.originals.clear();
  setProofreading(false);
  state.responses.clear();
  Object.entries(saved?.progress?.responses || {}).forEach(([key, value]) => {
    if (state.questions.some((question) => question.id === key)) state.responses.set(key, value);
  });
  const savedIndex = Number(saved?.progress?.current || 0);
  state.current = Math.min(Math.max(savedIndex, 0), state.questions.length - 1);
  ui.fileName.textContent = file.name;
  ui.fileMeta.textContent = `${Math.ceil(file.size / 1024)} KB · ${state.questions.length} 道题目`;
  ui.bankName.textContent = state.bankName;
  ui.listCount.textContent = String(state.questions.length);
  const notes = [];
  if (result.skipped.length) {
    notes.push(`未导入第 ${result.skipped.join("、")} 题：未能识别到题干内容。`);
  }
  if (result.unresolvedImages) {
    notes.push(`${result.unresolvedImages} 张 Word 图片无法读取，含公式图片的题目请核对原文。`);
  }
  if (notes.length) notes.push("点「校对」可对照 Word 原文逐题核对并修正。");
  ui.skippedNote.hidden = notes.length === 0;
  ui.skippedNote.textContent = notes.join(" ");
  ui.welcome.hidden = true;
  ui.workspace.hidden = false;
  render();
  await persistBank();
  showToast(`已解析 ${state.questions.length} 道题目，可点「校对」对照原文核对`);
}

ui.input.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  document.body.classList.add("is-loading");
  try {
    const result = await loadWord(file);
    await startQuiz(file, result);
  } catch (error) {
    console.error("[Word 导入]", error?.stack || String(error));
    showToast(error.message || "解析 Word 失败");
  } finally {
    document.body.classList.remove("is-loading");
  }
});

ui.submit.addEventListener("click", () => {
  const question = currentQuestion();
  const response = responseFor(question);
  if (question.type === "subjective") {
    if (!(response.text || "").trim()) {
      showToast("请先填写答案");
      return;
    }
    response.submitted = true;
    response.correct = null;
    render();
    schedulePersist();
    return;
  }
  if (!response.selected.length) {
    showToast("请先选择答案");
    return;
  }
  response.submitted = true;
  response.correct = sameAnswer(response.selected, question.answer);
  render();
  schedulePersist();
});

ui.previous.addEventListener("click", () => {
  if (state.current > 0) {
    state.current -= 1;
    render();
  }
});

ui.next.addEventListener("click", () => {
  if (state.current < state.questions.length - 1) {
    state.current += 1;
    render();
  }
});

ui.restart.addEventListener("click", () => {
  state.responses.clear();
  state.current = 0;
  render();
  schedulePersist();
  showToast("已开始新的练习");
});

ui.proofreadButton.addEventListener("click", () => {
  if (!state.questions.length) {
    showToast("请先导入 Word 或打开题库");
    return;
  }
  setProofreading(true);
});

ui.proofExit.addEventListener("click", () => {
  switchProofQuestion(() => {
    setProofreading(false);
    render();
  });
});

ui.proofPrev.addEventListener("click", () => {
  if (state.current === 0) return;
  switchProofQuestion(() => {
    state.current -= 1;
    renderProofread();
    render();
  });
});

ui.proofNext.addEventListener("click", () => {
  if (state.current >= state.questions.length - 1) return;
  switchProofQuestion(() => {
    state.current += 1;
    renderProofread();
    render();
  });
});

ui.proofType.addEventListener("change", () => syncProofFields());

ui.proofAddOption.addEventListener("click", addProofOption);

ui.proofSave.addEventListener("click", saveProofread);

ui.proofRevert.addEventListener("click", revertProofread);

ui.docLocate.addEventListener("click", () => renderDocScope());

ui.docScope.addEventListener("click", () => {
  state.docFull = !state.docFull;
  ui.docScope.textContent = state.docFull ? "全文" : "仅看本题";
  ui.docScope.classList.toggle("on", state.docFull);
  renderDocScope();
});

ui.deleteBank.addEventListener("click", async () => {
  if (!state.bankId) {
    showToast("当前题库还没有保存");
    return;
  }
  await removeBankById(state.bankId);
});

ui.exportBank.addEventListener("click", () => {
  if (!state.questions.length) {
    showToast("还没有题目可以导出");
    return;
  }
  const count = downloadBankFile({
    name: state.bankName || ui.bankName.textContent || "题库",
    source: "word",
    questions: state.questions,
  });
  showToast(`已导出 ${count} 道题到下载目录`);
});

ui.bankInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    await importBankFile(file);
  } catch (error) {
    console.error("[题库] 导入失败", error);
    showToast(`导入失败：${error.message || "文件格式不正确"}`);
  }
});

renderBankLibrary();
ensurePersistence();
