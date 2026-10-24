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
import {
  collectExplanationImages,
  matchQuestionImages,
  matchQuestionSourceTable,
} from "./word-images.js";

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
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FORMULA_SPACING_MIN = 150;
const FORMULA_SPACING_MAX = 1100;
const FORMULA_IMAGE_ROW_TOLERANCE = 3;
const TYPE_LABELS = { single: "单选题", multiple: "多选题", subjective: "主观题" };
const FORMULA_PLACEHOLDER = "〔公式〕";
const VML_NS = "urn:schemas-microsoft-com:vml";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMU_PER_POINT = 12700;

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 3200);
}

function localName(node) {
  return node.localName || node.nodeName.split(":").pop();
}

function formulaPlaceholder(run) {
  const properties = Array.from(run.children).find((child) => localName(child) === "rPr");
  const spacing = Array.from(properties?.children || []).find((child) => localName(child) === "spacing");
  if (!spacing) return false;

  const value = Number(
    spacing.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "val"),
  );
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
  return indexes;
}

function zipPathForWordTarget(target) {
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

function mimeTypeForImage(path) {
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

  const relationshipsFile = zip.file("word/_rels/document.xml.rels");
  if (!relationshipsFile) throw new Error("Word 中包含公式图片，但找不到图片关系文件");
  const relationshipsXml = await relationshipsFile.async("string");
  const relationshipsDocument = new DOMParser().parseFromString(relationshipsXml, "application/xml");
  if (relationshipsDocument.querySelector("parsererror")) {
    throw new Error("Word 图片关系 XML 无法解析");
  }

  const relationships = new Map(
    Array.from(relationshipsDocument.getElementsByTagNameNS("*", "Relationship"), (relationship) => [
      relationship.getAttribute("Id"),
      {
        target: relationship.getAttribute("Target"),
        external: relationship.getAttribute("TargetMode") === "External",
      },
    ]),
  );
  const body = document.getElementsByTagNameNS("*", "body")[0];
  if (!body) return { pages: [], unresolvedImages: 0 };
  const pages = [];
  const imageCache = new Map();
  let unresolvedImages = 0;

  const readImage = async (relationshipId) => {
    if (!relationshipId) return null;
    if (imageCache.has(relationshipId)) return imageCache.get(relationshipId);
    const relationship = relationships.get(relationshipId);
    if (!relationship || relationship.external) {
      imageCache.set(relationshipId, null);
      return null;
    }
    const path = zipPathForWordTarget(relationship.target);
    const file = zip.file(path);
    if (!file) {
      imageCache.set(relationshipId, null);
      return null;
    }
    const src = `data:${mimeTypeForImage(path)};base64,${await file.async("base64")}`;
    imageCache.set(relationshipId, src);
    return src;
  };

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
  let cursor = { page: 0, row: 0 };
  const questionImagePositions = result.questions.map(() => null);
  for (const [index, question] of result.questions.entries()) {
    const nextQuestionIndex = paragraphIndexes.get(question.number + 1) ?? Number.POSITIVE_INFINITY;
    const questionRange = paragraphIndexes.has(question.number)
      ? { start: paragraphIndexes.get(question.number), end: nextQuestionIndex }
      : null;
    const match =
      matchQuestionSourceTable(question, pages, cursor) ||
      (questionRange && matchQuestionImages(question, pages, cursor, questionRange)) ||
      matchQuestionImages(question, pages, cursor);
    if (!match) continue;
    questionImagePositions[index] = match;
    cursor = match;
  }

  cursor = { page: 0, row: 0 };
  for (const [index, question] of result.questions.entries()) {
    if (questionImagePositions[index]) cursor = questionImagePositions[index];
    const nextQuestionImage = questionImagePositions.slice(index + 1).find(Boolean) || {
      page: pages.length,
      row: 0,
    };
    cursor = collectExplanationImages(question, pages, cursor, nextQuestionImage);
  }
  return { ...result, unresolvedImages };
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
      return `<button class="list-item ${index === state.current ? "active" : ""} ${status}" data-index="${index}" type="button">
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
        reference ? renderFormulaContent(reference, [], FORMULA_PLACEHOLDER) : "文档未提供参考答案"
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
  ui.skippedNote.hidden = notes.length === 0;
  ui.skippedNote.textContent = notes.join(" ");
  ui.welcome.hidden = true;
  ui.workspace.hidden = false;
  render();
  await persistBank();
  showToast(`已解析 ${state.questions.length} 道题目，已存入题库`);
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
