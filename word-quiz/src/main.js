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
  formulaCount,
  renderFormulaContent,
} from "../../src/question-text.js";

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

function splitNumberedQuestions(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const choiceSection = lines.findIndex((line) => /^[一二三四五六七八九十]+、.*选择题/.test(line.trim()));
  const first = lines.findIndex(
    (line, index) => index > choiceSection && /^\s*1\s*[.．、]\s*/.test(line),
  );
  if (first < 0) throw new Error("没有识别到从“1.”开始编号的题目");

  const blocks = [];
  let current = [];
  let expected = 1;
  for (const line of lines.slice(first)) {
    const match = line.match(/^\s*(\d{1,2})\s*[.．、]\s*(.*)$/);
    if (match && Number(match[1]) === expected) {
      if (current.length) blocks.push(current.join("\n"));
      current = [match[2]];
      expected += 1;
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

function answerFromLine(line) {
  const match = line.match(
    /[【\[（(]?\s*(?:参考答案|正确答案|标准答案|答案)\s*[】\]）)]?\s*[：:＝=]?\s*([A-FＡ-Ｆ](?:[\s,，、和及与]*[A-FＡ-Ｆ])*)/i,
  );
  if (!match) return null;
  const answer = match[1]
    .replace(/[Ａ-Ｆ]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 0xfee0))
    .match(/[A-F]/gi);
  return answer ? [...new Set(answer.map((letter) => letter.toUpperCase()))] : null;
}

function optionMarkers(line) {
  const markers = [];
  const pattern = /([A-FＡ-Ｆ])\s*[.．、:：]\s*/gi;
  let match;
  while ((match = pattern.exec(line))) {
    const key = match[1].replace(/[Ａ-Ｆ]/g, (letter) =>
      String.fromCharCode(letter.charCodeAt(0) - 0xfee0),
    ).toUpperCase();
    markers.push({ key, start: match.index, end: pattern.lastIndex });
  }
  return markers;
}

function parseChoices(lines) {
  const title = [];
  const options = [];
  const optionKeys = new Set();
  let readingOptions = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const markers = optionMarkers(line);
    const consecutive =
      markers.length >= 2 &&
      markers.every((marker, index) => index === 0 || marker.key.charCodeAt(0) === markers[index - 1].key.charCodeAt(0) + 1);

    if (consecutive) {
      const prefix = line.slice(0, markers[0].start).trim();
      if (prefix) title.push(prefix);
      markers.forEach((marker, index) => {
        const end = markers[index + 1]?.start ?? line.length;
        const content = line.slice(marker.end, end).trim();
        if (content && !optionKeys.has(marker.key)) {
          options.push({ key: marker.key, content });
          optionKeys.add(marker.key);
        }
      });
      readingOptions = true;
      continue;
    }

    const single = line.match(/^\s*([A-FＡ-Ｆ])(?:\s*[.．、:：]|\s+)\s*(.+)$/i);
    if (single && (readingOptions || single[1].toUpperCase() === "A")) {
      const key = single[1].replace(/[Ａ-Ｆ]/g, (letter) =>
        String.fromCharCode(letter.charCodeAt(0) - 0xfee0),
      ).toUpperCase();
      if (!optionKeys.has(key)) {
        options.push({ key, content: single[2].trim() });
        optionKeys.add(key);
      } else {
        title.push(line);
      }
      readingOptions = true;
      continue;
    }

    if (readingOptions && options.length) {
      options[options.length - 1].content += `\n${line}`;
      continue;
    }

    title.push(line);
  }

  options.sort((a, b) => a.key.localeCompare(b.key));
  return { title: title.join("\n").trim(), options };
}

function parseInstrumentTable(lines) {
  const headerIndex = lines.findIndex((line) => line.includes("实验内容") && line.includes("仪器或材料"));
  if (headerIndex < 0) return null;

  const text = lines.join("");
  const requiredContent = [
    "灼烧海带",
    "坩埚、泥三角",
    "加热浓缩",
    "表面皿、玻璃棒",
    "称量",
    "电子天平、称量纸",
    "量取",
    "移液管、锥",
  ];
  if (!requiredContent.every((part) => text.includes(part))) return null;

  return {
    title: lines.slice(0, headerIndex).join("\n").trim(),
    options: [
      { key: "A", content: "灼烧海带；坩埚、泥三角" },
      { key: "B", content: "加热浓缩 NaCl 溶液；表面皿、玻璃棒" },
      { key: "C", content: "称量 5.0g NaOH 固体；电子天平、称量纸" },
      { key: "D", content: "量取稀溶液；移液管、锥形瓶" },
    ],
    sourceTable: true,
  };
}

function parseQuestion(block, number) {
  const lines = block.split("\n");
  const answerIndex = lines.findIndex((line) => answerFromLine(line));
  if (answerIndex < 0) return null;
  const answer = answerFromLine(lines[answerIndex]);
  const analysisIndex = lines.findIndex(
    (line, index) => index > answerIndex && /【\s*(?:解析|答案解析|试题解析|详解)\s*】/.test(line),
  );
  const choiceLines = lines.slice(0, answerIndex);
  const parsed = parseInstrumentTable(choiceLines) || parseChoices(choiceLines);
  if (!parsed.title || parsed.options.length < 2) return null;

  const explanationLines =
    analysisIndex < 0
      ? []
      : lines.slice(analysisIndex).map((line) => line.replace(/^[【\[（(]\s*(?:解析|答案解析|试题解析|详解|分析|详解)\s*[】\]）)]?\s*[：:＝=]?\s*/, ""));

  return {
    id: `question-${number}`,
    number,
    title: parsed.title,
    options: parsed.options,
    sourceTable: parsed.sourceTable,
    answer: answer.sort(),
    type: answer.length > 1 ? "multiple" : "single",
    explanation: explanationLines.join("\n").trim(),
  };
}

function parseQuestionBank(text) {
  const blocks = splitNumberedQuestions(text);
  const questions = [];
  const skipped = [];
  blocks.forEach((block, index) => {
    const question = parseQuestion(block, index + 1);
    if (question) questions.push(question);
    else skipped.push(index + 1);
  });
  if (!questions.length) {
    throw new Error("没有解析到带选项和标准答案的选择题，请确认文档包含答案解析");
  }
  return { questions, skipped };
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

async function extractVmlImagePages(zip, documentXmlText) {
  const document = new DOMParser().parseFromString(documentXmlText, "application/xml");
  const shapes = Array.from(document.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "shape"));
  if (!shapes.length) return { pages: [], unresolvedImages: 0 };

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
  const pages = [];
  let unresolvedImages = 0;

  for (const [paragraphIndex, paragraph] of Array.from(body.children).entries()) {
    if (localName(paragraph) !== "p") continue;
    const paragraphShapes = Array.from(
      paragraph.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "shape"),
    );
    if (!paragraphShapes.length) continue;

    const images = [];
    for (const shape of paragraphShapes) {
      const style = shape.getAttribute("style");
      const width = styleLength(style, "width");
      const height = styleLength(style, "height");
      if (width < 6 || height < 6) continue;

      const imageData = shape.getElementsByTagNameNS("*", "imagedata")[0];
      const relationshipId = imageData?.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      );
      const relationship = relationships.get(relationshipId);
      if (!relationship || relationship.external) {
        unresolvedImages += 1;
        continue;
      }

      const path = zipPathForWordTarget(relationship.target);
      const file = zip.file(path);
      if (!file) {
        unresolvedImages += 1;
        continue;
      }

      images.push({
        x: styleLength(style, "margin-left"),
        y: styleLength(style, "margin-top"),
        width,
        height,
        src: `data:${mimeTypeForImage(path)};base64,${await file.async("base64")}`,
      });
    }

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

function matchQuestionImages(question, imagePages, cursor, paragraphRange = null) {
  const targets = [
    { text: question.title, setImages: (images) => (question.titleImages = images) },
    ...question.options.map((option) => ({
      text: option.content,
      setImages: (images) => (option.formulaImages = images),
    })),
  ].map((target) => ({ ...target, count: formulaCount(target.text) })).filter((target) => target.count > 0);
  if (!targets.length) return null;

  for (let pageIndex = cursor.page; pageIndex < imagePages.length; pageIndex += 1) {
    const paragraphIndex = imagePages[pageIndex].paragraphIndex;
    if (
      paragraphRange &&
      (paragraphIndex < paragraphRange.start || paragraphIndex >= paragraphRange.end)
    ) {
      continue;
    }
    const rows = imagePages[pageIndex].rows;
    const startAt = pageIndex === cursor.page ? cursor.row : 0;
    for (let start = startAt; start < rows.length; start += 1) {
      let targetIndex = 0;
      let complete = true;
      let endRow = start;
      const assignments = targets.map(() => []);
      for (let rowIndex = start; rowIndex < rows.length && targetIndex < targets.length; rowIndex += 1) {
        for (const image of rows[rowIndex].images) {
          if (targetIndex >= targets.length) {
            complete = false;
            break;
          }
          assignments[targetIndex].push(image);
          if (assignments[targetIndex].length === targets[targetIndex].count) {
            targetIndex += 1;
          }
        }
        endRow = rowIndex + 1;
        if (!complete) break;
      }
      if (complete && targetIndex === targets.length) {
        assignments.forEach((images, index) => targets[index].setImages(images));
        return { page: pageIndex, row: endRow };
      }
    }
  }
  return null;
}

function matchQuestionSourceTable(question, imagePages, cursor) {
  if (!question.sourceTable) return null;

  for (let pageIndex = cursor.page; pageIndex < imagePages.length; pageIndex += 1) {
    const rows = imagePages[pageIndex].rows;
    const startAt = pageIndex === cursor.page ? cursor.row : 0;
    for (let rowIndex = startAt; rowIndex < rows.length; rowIndex += 1) {
      const image = rows[rowIndex].images.find(
        (candidate) =>
          candidate.width >= 180 &&
          candidate.height >= 180 &&
          candidate.width / candidate.height >= 0.9 &&
          candidate.width / candidate.height <= 1.05,
      );
      if (!image) continue;
      question.tableImage = image;
      return { page: pageIndex, row: rowIndex + 1 };
    }
  }
  return null;
}

function collectExplanationImages(question, imagePages, cursor, endCursor) {
  let remaining = formulaCount(question.explanation);
  if (!remaining) return cursor;

  const images = [];
  let page = cursor.page;
  let row = cursor.row;
  while (
    page < imagePages.length &&
    remaining > 0 &&
    (page < endCursor.page || (page === endCursor.page && row < endCursor.row))
  ) {
    const rows = imagePages[page].rows;
    while (
      row < rows.length &&
      remaining > 0 &&
      (page < endCursor.page || (page === endCursor.page && row < endCursor.row))
    ) {
      const rowImages = rows[row].images;
      images.push(...rowImages);
      remaining -= rowImages.length;
      row += 1;
    }
    if (remaining > 0) {
      page += 1;
      row = 0;
    }
  }

  question.explanationImages = images;
  return { page, row };
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
  const { pages, unresolvedImages } = await extractVmlImagePages(zip, xml);
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
    state.responses.set(question.id, { selected: [], submitted: false, correct: false });
  }
  return state.responses.get(question.id);
}

function sameAnswer(left, right) {
  return left.length === right.length && [...left].sort().every((key, index) => key === [...right].sort()[index]);
}

function renderList() {
  ui.questionList.innerHTML = state.questions
    .map((question, index) => {
      const response = responseFor(question);
      const status = response.submitted ? (response.correct ? "correct" : "wrong") : "";
      const mark = response.submitted ? (response.correct ? "✓" : "·") : "";
      return `<button class="list-item ${index === state.current ? "active" : ""} ${status}" data-index="${index}" type="button">
        <span class="list-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="list-title">${renderFormulaContent(question.title, question.titleImages)}</span>
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
        <span class="option-content">${renderFormulaContent(option.content, option.formulaImages)}</span>
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

function renderFeedback(question, response) {
  if (!response.submitted) {
    ui.feedback.hidden = true;
    ui.feedback.className = "feedback";
    ui.feedback.innerHTML = "";
    return;
  }
  const answer = question.answer.join("、");
  ui.feedback.hidden = false;
  ui.feedback.className = `feedback ${response.correct ? "feedback-correct" : "feedback-wrong"}`;
  ui.feedback.innerHTML = `
    <div class="feedback-heading">${response.correct ? "回答正确" : "再接再厉"}</div>
    <div class="feedback-answer">正确答案：<strong>${escapeHtml(answer)}</strong></div>
    ${
      question.explanation
        ? `<div class="feedback-explanation"><strong>解析</strong><p>${renderFormulaContent(question.explanation, [], question.explanationImages?.length ? "原文公式见下方" : "原文公式图片未能匹配")}</p>
          ${
            question.explanationImages?.length
              ? `<div class="formula-source"><strong>Word 原文公式图片</strong><div class="formula-gallery">${question.explanationImages
                  .map(
                    (image, index) =>
                      `<img class="formula-image" src="${escapeHtml(image.src)}" alt="Word 原文公式 ${index + 1}">`,
                  )
                  .join("")}</div></div>`
              : ""
          }</div>`
        : '<div class="feedback-explanation"><p>文档未提供解析。</p></div>'
    }`;
}

function renderStats() {
  const total = state.questions.length;
  const answered = [...state.responses.values()].filter((response) => response.submitted).length;
  const correct = [...state.responses.values()].filter((response) => response.submitted && response.correct).length;
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
  ui.type.textContent = question.type === "multiple" ? "多选题" : "单选题";
  ui.title.innerHTML = renderFormulaContent(question.title, question.titleImages);
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
  ui.fileMeta.textContent = `${state.questions.length} 道选择题 · 来自本机题库`;
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
  ui.fileMeta.textContent = `${state.questions.length} 道选择题 · 来自导入的题库文件`;
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
  ui.fileMeta.textContent = `${Math.ceil(file.size / 1024)} KB · ${state.questions.length} 道选择题`;
  ui.bankName.textContent = state.bankName;
  ui.listCount.textContent = String(state.questions.length);
  const notes = [];
  if (result.skipped.length) {
    notes.push(`未导入第 ${result.skipped.join("、")} 题：缺少选项或可识别答案（通常为填空/解答题）。`);
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
  showToast(`已解析 ${state.questions.length} 道选择题，已存入题库`);
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
