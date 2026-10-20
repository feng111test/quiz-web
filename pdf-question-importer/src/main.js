import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, OEM } from "tesseract.js";
import tesseractWorkerUrl from "tesseract.js/dist/worker.min.js?url";
import tesseractCoreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import "./styles.css";
import {
  deleteBank as removeBank,
  ensurePersistence,
  formatSavedAt,
  listBanks,
  saveBank,
} from "../../src/question-bank.js";
import { downloadBankFile, readBankFile, toPdfQuestions } from "../../src/bank-file.js";
import {
  VISION_PRESETS,
  VISION_PROMPT,
  canvasToJpegDataUrl,
  fetchVisionModels,
  loadVisionSettings,
  requestVisionJson,
  saveVisionSettings,
  testVisionConnection,
  visionPresetOf,
} from "../../src/vision-client.js";
import { visionQuestionsFromPayload } from "../../src/vision-questions.js";

document.documentElement.classList.toggle("embedded", new URLSearchParams(location.search).has("embedded"));

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const byId = (id) => document.getElementById(id);
const elements = {
  input: byId("pdfInput"),
  fileCard: byId("fileCard"),
  fileName: byId("fileName"),
  documentMeta: byId("documentMeta"),
  pageList: byId("pageList"),
  pageCount: byId("pageCount"),
  pageLabel: byId("pageLabel"),
  stage: byId("pdfStage"),
  welcome: byId("welcome"),
  pageCanvasWrap: byId("pageCanvasWrap"),
  pageCanvasSurface: byId("pageCanvasSurface"),
  canvas: byId("pdfCanvas"),
  cropLayer: byId("cropLayer"),
  stageStatus: byId("stageStatus"),
  pageHint: byId("pageHint"),
  prevPage: byId("prevPage"),
  nextPage: byId("nextPage"),
  zoomIn: byId("zoomIn"),
  zoomOut: byId("zoomOut"),
  zoomLabel: byId("zoomLabel"),
  screenshotMode: byId("screenshotMode"),
  clearCrop: byId("clearCrop"),
  runOcr: byId("runOcr"),
  rerunAllOcr: byId("rerunAllOcr"),
  aiRecognizePage: byId("aiRecognizePage"),
  aiRecognizeAll: byId("aiRecognizeAll"),
  aiSettingsToggle: byId("aiSettingsToggle"),
  aiSettingsBody: byId("aiSettingsBody"),
  aiPreset: byId("aiPreset"),
  aiBaseUrl: byId("aiBaseUrl"),
  aiModel: byId("aiModel"),
  aiModelOptions: byId("aiModelOptions"),
  aiFetchModels: byId("aiFetchModels"),
  aiApiKey: byId("aiApiKey"),
  aiSaveSettings: byId("aiSaveSettings"),
  aiTestConnection: byId("aiTestConnection"),
  aiSettingsHint: byId("aiSettingsHint"),
  ocrStateDot: byId("ocrStateDot"),
  ocrStatus: byId("ocrStatus"),
  ocrElapsed: byId("ocrElapsed"),
  ocrProgress: byId("ocrProgress"),
  ocrPhase: byId("ocrPhase"),
  ocrLog: byId("ocrLog"),
  copyOcrLog: byId("copyOcrLog"),
  questionType: byId("questionType"),
  questionPage: byId("questionPage"),
  viewQuestionPage: byId("viewQuestionPage"),
  questionTitle: byId("questionTitle"),
  optionsField: byId("optionsField"),
  optionList: byId("optionList"),
  addOption: byId("addOption"),
  questionAnswer: byId("questionAnswer"),
  questionExplanation: byId("questionExplanation"),
  questionCount: byId("questionCount"),
  previousQuestion: byId("previousQuestion"),
  confirmQuestion: byId("confirmQuestion"),
  nextQuestion: byId("nextQuestion"),
  imageCount: byId("imageCount"),
  imageList: byId("imageList"),
  questionImageInput: byId("questionImageInput"),
  newQuestion: byId("newQuestion"),
  saveQuestion: byId("saveQuestion"),
  saveStatus: byId("saveStatus"),
  bankList: byId("bankList"),
  bankCount: byId("bankCount"),
  bankInput: byId("bankInput"),
  exportJson: byId("exportJson"),
  startPractice: byId("startPractice"),
  practiceView: byId("practiceView"),
  practiceTitle: byId("practiceTitle"),
  practiceProgress: byId("practiceProgress"),
  practiceQuestionList: byId("practiceQuestionList"),
  practiceNumber: byId("practiceNumber"),
  practiceType: byId("practiceType"),
  practiceQuestion: byId("practiceQuestion"),
  practiceImages: byId("practiceImages"),
  practiceOptions: byId("practiceOptions"),
  practiceFeedback: byId("practiceFeedback"),
  practicePrevious: byId("practicePrevious"),
  practiceNext: byId("practiceNext"),
  practiceSubmit: byId("practiceSubmit"),
  practiceRestart: byId("practiceRestart"),
  practiceClose: byId("practiceClose"),
  toast: byId("toast"),
};

const state = {
  pdf: null,
  fileName: "",
  page: 1,
  pageCount: 0,
  fileSize: 0,
  zoom: 1,
  questions: [],
  activeId: null,
  draft: newQuestion(),
  practiceMode: false,
  practiceIndex: 0,
  practiceAnswers: {},
  worker: null,
  busy: false,
  cropStart: null,
  cropRect: null,
  cropMode: false,
  toastTimer: null,
  bankId: null,
  bankName: "",
  saveTimer: null,
  renderQueue: Promise.resolve(),
  ocrRun: {
    active: false,
    startedAt: 0,
    lastEventAt: 0,
    lastHeartbeatAt: 0,
    timer: null,
    phase: "",
    progress: 0,
    logs: [],
    lastLoggedStatus: "",
    lastLoggedProgress: -1,
    pageNumber: 1,
  },
};

const MAX_PDF_BYTES = 100 * 1024 * 1024;

function newQuestion() {
  return {
    id: "",
    type: "single",
    title: "",
    options: [
      { key: "A", content: "" },
      { key: "B", content: "" },
      { key: "C", content: "" },
      { key: "D", content: "" },
    ],
    answer: "",
    explanation: "",
    images: [],
    sourcePage: 1,
  };
}

function activeQuestion() {
  return state.activeId
    ? state.questions.find((question) => question.id === state.activeId)
    : state.draft;
}

function repairOptionsFromTitle(question) {
  if (!question.title) return false;
  const existingOptions = Array.isArray(question.options) ? question.options : [];
  const combinedText = [
    question.title,
    ...existingOptions.map((option) => `${option.key}. ${option.content}`),
  ].join("\n");
  const parsed = splitOcrQuestions(combinedText, question.sourcePage || 1)[0];
  if (!parsed?.options.some((option) => option.content)) return false;
  const needsRepair =
    parsed.options.length > existingOptions.length ||
    (!existingOptions.some((option) => option.content.trim()) && parsed.title !== question.title);
  if (!needsRepair) return false;
  question.title = parsed.title;
  question.options = parsed.options;
  return true;
}

function updateButtons() {
  const hasPdf = Boolean(state.pdf);
  elements.prevPage.disabled = !hasPdf || state.page <= 1 || state.busy;
  elements.nextPage.disabled = !hasPdf || state.page >= state.pageCount || state.busy;
  elements.zoomOut.disabled = !hasPdf || state.zoom <= 0.75 || state.busy;
  elements.zoomIn.disabled = !hasPdf || state.zoom >= 2.5 || state.busy;
  elements.runOcr.disabled = !hasPdf || state.busy;
  elements.rerunAllOcr.disabled = !hasPdf || state.busy;
  elements.aiRecognizePage.disabled = !hasPdf || state.busy;
  elements.aiRecognizeAll.disabled = !hasPdf || state.busy;
  elements.aiTestConnection.disabled = state.busy;
  elements.aiFetchModels.disabled = state.busy;
  elements.screenshotMode.disabled = !hasPdf || state.busy;
  elements.screenshotMode.textContent = state.cropMode ? "退出截图" : "截图并插入";
  elements.screenshotMode.classList.toggle("accent", state.cropMode);
  elements.clearCrop.disabled = !state.cropRect;
  elements.input.disabled = state.busy;
  elements.exportJson.disabled = state.questions.length === 0;
  elements.startPractice.disabled = state.questions.length === 0;
  elements.startPractice.textContent = `▶ 开始刷题（${state.questions.length}）`;
  elements.saveQuestion.disabled = state.busy;
  elements.newQuestion.disabled = state.busy;
  const activeIndex = state.questions.findIndex((question) => question.id === state.activeId);
  elements.previousQuestion.disabled = state.busy || activeIndex <= 0;
  elements.nextQuestion.disabled = state.busy || activeIndex < 0 || activeIndex >= state.questions.length - 1;
  elements.confirmQuestion.disabled = state.busy || activeIndex < 0;
  elements.confirmQuestion.textContent =
    activeIndex >= 0 && state.questions[activeIndex].reviewed
      ? activeIndex === state.questions.length - 1 ? "已确认" : "已确认 · 下一题"
      : activeIndex === state.questions.length - 1 ? "确认本题" : "确认并下一题";
}

function setBusy(busy, message = "") {
  state.busy = busy;
  elements.stageStatus.hidden = !busy;
  elements.stageStatus.textContent = message;
  document.body.classList.toggle("is-busy", busy);
  updateButtons();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function safeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function restoreBankFor(fileName) {
  const name = (fileName || "").replace(/\.pdf$/i, "");
  if (!name) return;
  const banks = await listBanks();
  const matched = banks.find((bank) => bank.source === "pdf" && bank.name === name);
  if (!matched?.questions?.length) return;
  state.bankId = matched.id;
  state.bankName = matched.name;
  state.questions = matched.questions;
  state.practiceAnswers = matched.progress?.practiceAnswers || {};
  const repaired = state.questions.filter(repairOptionsFromTitle).length;
  renderQuestionList();
  if (state.questions[0]) loadQuestion(state.questions[0]);
  updateButtons();
  if (repaired) await persistBank();
  showToast(repaired
    ? `已载入本机题库并拆分修复 ${repaired} 道题的选项，请人工校对`
    : `已载入本机题库「${matched.name}」的 ${matched.questions.length} 道题`);
  return true;
}

async function openPdf(file) {
  if (!file) return false;
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("请选择 PDF 文件");
    return false;
  }
  if (file.size > MAX_PDF_BYTES) {
    showToast("PDF 文件不能超过 100 MB");
    return false;
  }

  closePdf();
  state.bankId = null;
  state.bankName = "";
  state.questions = [];
  state.practiceAnswers = {};
  state.activeId = null;
  state.draft = newQuestion();
  renderQuestionList();
  setBusy(true, "正在打开 PDF…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.pdf = await pdfjs.getDocument({ data: bytes }).promise;
    state.fileName = file.name;
    state.fileSize = file.size;
    state.pageCount = state.pdf.numPages;
    state.page = 1;
    state.zoom = 1;
    elements.fileCard.classList.remove("empty");
    elements.fileName.textContent = file.name;
    elements.documentMeta.textContent = `${formatBytes(file.size)} · ${state.pageCount} 页 · 自动优先提取 PDF 文本`;
    elements.welcome.hidden = true;
    elements.pageCanvasWrap.hidden = false;
    elements.pageCount.textContent = String(state.pageCount);
    renderPageList();
    const hasSavedBank = await restoreBankFor(file.name);
    setBusy(true, "正在绘制第一页…");
    await renderPage();
    if (hasSavedBank) {
      showToast("已打开 PDF 和本机题库");
    } else {
      setBusy(false);
      await runOcr({ allPages: true });
    }
    return true;
  } catch (error) {
    console.error("[PDF 导入] 打开失败", error?.stack || String(error));
    closePdf();
    showToast(`无法打开 PDF：${error.message || "文件可能已损坏或受密码保护"}`);
    return false;
  } finally {
    setBusy(false);
  }
}

async function openPdfFiles(files) {
  const pdfFiles = [];
  const rejectedFiles = [];
  for (const file of files) {
    if ((file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) ||
        file.size > MAX_PDF_BYTES) {
      rejectedFiles.push(file.name);
    } else {
      pdfFiles.push(file);
    }
  }
  if (!pdfFiles.length) {
    showToast(rejectedFiles.length ? `无法处理：${rejectedFiles.slice(0, 3).join("、")}（仅支持不超过 100 MB 的 PDF）` : "请选择 PDF 文件");
    return;
  }

  if (pdfFiles.length > 1 && state.questions.length &&
      !window.confirm(`将依次打开 ${pdfFiles.length} 份 PDF；当前页面会切换，但已保存题库不会被覆盖。继续吗？`)) {
    return;
  }

  let completed = 0;
  let failed = 0;
  for (const [index, file] of pdfFiles.entries()) {
    showToast(`正在处理第 ${index + 1} / ${pdfFiles.length} 份：${file.name}`);
    if (await openPdf(file)) completed += 1;
    else failed += 1;
  }
  if (pdfFiles.length > 1) {
    showToast(`批次处理完成：成功 ${completed} 份，失败 ${failed} 份${rejectedFiles.length ? `，跳过 ${rejectedFiles.length} 个不支持文件` : ""}`);
  }
}

function closePdf() {
  if (state.pdf) {
    state.pdf.destroy();
    state.pdf = null;
  }
  state.pageCount = 0;
  state.fileSize = 0;
  state.page = 1;
  elements.pageCanvasWrap.hidden = true;
  elements.welcome.hidden = false;
  elements.fileCard.classList.add("empty");
  elements.fileName.textContent = "尚未选择文件";
  elements.documentMeta.textContent = "题目会自动保存到本机题库";
  elements.pageCount.textContent = "0";
  elements.pageList.classList.add("empty-pages");
  elements.pageList.innerHTML = '<div class="empty-note">选择 PDF 后显示页面</div>';
  elements.pageLabel.textContent = "等待导入 PDF";
  elements.canvas.width = 0;
  elements.canvas.height = 0;
  setCropMode(false);
  updateButtons();
}

function renderPageList() {
  elements.pageList.classList.remove("empty-pages");
  elements.pageList.innerHTML = "";
  for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber += 1) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `page-item${pageNumber === state.page ? " active" : ""}`;
    item.dataset.page = String(pageNumber);
    item.innerHTML = `
      <span class="page-thumb"><span class="thumb-lines"></span><b>${pageNumber}</b></span>
      <span class="page-item-copy"><strong>第 ${pageNumber} 页</strong><small>点击查看页面</small></span>
      <span class="page-arrow">›</span>`;
    item.addEventListener("click", () => goToPage(pageNumber));
    elements.pageList.append(item);
  }
}

function renderPage() {
  const task = state.renderQueue.then(() => renderPageNow());
  state.renderQueue = task.catch(() => {});
  return task;
}

async function renderPageNow(retries = 1) {
  if (!state.pdf) return;
  const pageNumber = state.page;
  const page = await state.pdf.getPage(state.page);
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(320, elements.stage.clientWidth - 56);
  const fitScale = Math.min(2, availableWidth / baseViewport.width);
  const scale = Math.max(0.55, fitScale * state.zoom);
  const viewport = page.getViewport({ scale });
  const canvas = elements.canvas;
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width)}px`;
  canvas.style.height = `${Math.ceil(viewport.height)}px`;
  elements.pageCanvasSurface.style.width = `${Math.ceil(viewport.width)}px`;
  elements.pageCanvasSurface.style.height = `${Math.ceil(viewport.height)}px`;
  clearCrop();
  try {
    await page.render({ canvasContext: context, viewport }).promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException" && retries > 0 && state.pdf && pageNumber === state.page) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return renderPageNow(retries - 1);
    }
    throw error;
  }
  if (pageNumber !== state.page) return;
  elements.pageLabel.textContent = `${state.fileName} · 第 ${pageNumber} / ${state.pageCount} 页`;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  elements.pageList.querySelectorAll(".page-item").forEach((item) => {
    const selected = Number(item.dataset.page) === pageNumber;
    item.classList.toggle("active", selected);
    if (selected) item.scrollIntoView({ block: "nearest" });
  });
  updateButtons();
}

async function goToPage(pageNumber) {
  if (!state.pdf || state.busy || pageNumber < 1 || pageNumber > state.pageCount) return;
  state.page = pageNumber;
  setBusy(true, `正在绘制第 ${pageNumber} 页…`);
  try {
    await renderPage();
  } catch (error) {
    console.error("[PDF 页面] 绘制失败", error);
    showToast("页面绘制失败，请重试");
  } finally {
    setBusy(false);
  }
}

function renderOptions(options) {
  elements.optionList.innerHTML = "";
  options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
      <span class="option-key">${safeText(option.key)}</span>
      <input class="field-control option-input" type="text" value="${safeText(option.content)}" placeholder="选项内容" aria-label="选项 ${safeText(option.key)}" data-index="${index}" />
      <button class="remove-option" type="button" aria-label="删除选项 ${safeText(option.key)}" data-index="${index}">×</button>`;
    elements.optionList.append(row);
  });
  elements.optionList.querySelectorAll(".option-input").forEach((input) => {
    input.addEventListener("input", () => {
      const question = activeQuestion();
      const option = question.options[Number(input.dataset.index)];
      if (option) {
        option.content = input.value;
        if (state.activeId) schedulePersist();
      }
    });
  });
  elements.optionList.querySelectorAll(".remove-option").forEach((button) => {
    button.addEventListener("click", () => {
      const question = activeQuestion();
      question.options.splice(Number(button.dataset.index), 1);
      renderOptions(question.options);
      if (state.activeId) schedulePersist();
    });
  });
}

function loadQuestion(question) {
  if (question.id && !state.activeId && hasUnsavedDraft() && !window.confirm("当前新题目还没保存，确定放弃它并切换题目吗？")) {
    return;
  }
  state.activeId = question.id || null;
  state.draft = question.id ? state.draft : question;
  elements.questionType.value = question.type;
  elements.questionPage.value = question.sourcePage || "";
  elements.questionTitle.value = question.title;
  elements.questionAnswer.value = question.answer;
  elements.questionExplanation.value = question.explanation;
  renderOptions(question.options);
  elements.optionsField.hidden = question.type === "judge";
  renderQuestionList();
  renderImages();
  elements.saveStatus.textContent = question.id ? "编辑中的修改会自动存入题库" : "新题目尚未保存到题库";
  updateButtons();
}

function moveQuestion(offset) {
  const currentIndex = state.questions.findIndex((question) => question.id === state.activeId);
  const nextQuestion = state.questions[currentIndex + offset];
  if (nextQuestion) loadQuestion(nextQuestion);
}

async function confirmQuestion() {
  const question = activeQuestion();
  if (!question?.id) {
    showToast("请先保存这道题，再确认校对");
    return;
  }
  question.reviewed = true;
  renderQuestionList();
  const currentIndex = state.questions.findIndex((item) => item.id === question.id);
  if (currentIndex < state.questions.length - 1) {
    loadQuestion(state.questions[currentIndex + 1]);
  } else {
    updateButtons();
    showToast("最后一道题已确认，题目校对完成");
  }
  await persistBank();
}

function hasUnsavedDraft() {
  return Boolean(
    state.draft.title.trim() ||
      state.draft.answer.trim() ||
      state.draft.explanation.trim() ||
      state.draft.options.some((option) => option.content.trim()) ||
      state.draft.images.length,
  );
}

function renderQuestionList() {
  const count = state.questions.length;
  elements.questionCount.textContent = `${count} 题`;
  elements.exportJson.disabled = count === 0;
  elements.startPractice.disabled = count === 0;
  elements.startPractice.textContent = `▶ 开始刷题（${count}）`;
  const section = document.createElement("section");
  section.className = "saved-questions";
  if (count) {
    section.innerHTML = `<div class="saved-heading"><strong>已整理题目</strong><span>${count}</span></div>`;
    state.questions.forEach((question, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `saved-question${question.id === state.activeId ? " active" : ""}`;
      item.innerHTML = `
        <span class="saved-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="saved-copy"><strong>${safeText(question.title || "未填写题干")}</strong><small>第 ${Number(question.sourcePage) || "—"} 页 · ${question.images.length} 张图片 · ${question.answer ? `答案 ${safeText(question.answer)}` : "答案待补"} · ${question.reviewed ? "已校对" : question.aiSuggested ? "AI 待校对" : "待校对"}${question.figureHint ? ` · ${question.images.length ? "已配图" : "建议裁图"}` : ""}</small></span>
        <span class="saved-edit">编辑</span>`;
      item.addEventListener("click", () => loadQuestion(question));
      section.append(item);
    });
  }
  const oldSection = document.querySelector(".saved-questions");
  if (oldSection) oldSection.replaceWith(section);
  else byId("fileCard").closest(".left-panel").append(section);
}

function practiceAnswer(question) {
  return state.practiceAnswers[question.id] || (state.practiceAnswers[question.id] = { selected: [], submitted: false, correct: false });
}

function normalizeAnswers(answer) {
  const value = String(answer || "").trim().toUpperCase();
  const answers = /^[A-F]+$/.test(value) ? value.split("") : value
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
  return [...new Set(answers)];
}

function renderPractice() {
  const question = state.questions[state.practiceIndex];
  if (!question) return;

  const response = practiceAnswer(question);
  const answer = normalizeAnswers(question.answer);
  const type = question.type === "multiple" ? "multiple" : question.type === "judge" ? "judge" : "single";

  elements.practiceTitle.textContent = state.fileName.replace(/\.pdf$/i, "") || "整理的题目";
  elements.practiceProgress.textContent = `${state.practiceIndex + 1} / ${state.questions.length} 题 · 已答 ${Object.values(state.practiceAnswers).filter((item) => item.submitted).length} 题`;
  elements.practiceNumber.textContent = `第 ${state.practiceIndex + 1} 题`;
  elements.practiceType.textContent = type === "multiple" ? "多选题" : type === "judge" ? "判断题" : "单选题";
  elements.practiceQuestion.textContent = question.title;
  elements.practicePrevious.disabled = state.practiceIndex === 0;
  elements.practiceNext.disabled = state.practiceIndex === state.questions.length - 1;
  elements.practiceSubmit.hidden = response.submitted;
  elements.practiceImages.innerHTML = question.images.map((image, index) =>
    `<img src="${safeText(image.dataUrl)}" alt="题目图片 ${index + 1}" />`
  ).join("");

  const options = type === "judge"
    ? [{ key: "正确", content: "正确" }, { key: "错误", content: "错误" }]
    : question.options.filter((option) => option.content.trim());
  elements.practiceOptions.innerHTML = options.map((option) => {
    const selected = response.selected.includes(option.key);
    const correct = answer.includes(option.key);
    const statusClass = response.submitted && correct ? " is-correct" : response.submitted && selected ? " is-wrong" : "";
    return `<label class="practice-option${selected ? " selected" : ""}${statusClass}">
      <input type="${type === "multiple" ? "checkbox" : "radio"}" name="practiceAnswer" value="${safeText(option.key)}" ${selected ? "checked" : ""} ${response.submitted ? "disabled" : ""} />
      <strong>${safeText(option.key)}</strong><span>${safeText(option.content)}</span>
      ${response.submitted && correct ? '<small>正确答案</small>' : ""}
    </label>`;
  }).join("");

  elements.practiceOptions.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (type === "multiple") {
        const selected = new Set(response.selected);
        if (input.checked) selected.add(input.value);
        else selected.delete(input.value);
        response.selected = [...selected];
      } else {
        response.selected = [input.value];
      }
      elements.practiceOptions.querySelectorAll(".practice-option").forEach((option) => {
        option.classList.toggle("selected", option.querySelector("input").checked);
      });
    });
  });

  elements.practiceFeedback.hidden = !response.submitted;
  elements.practiceFeedback.className = `practice-feedback${response.correct ? " correct" : " incorrect"}`;
  elements.practiceFeedback.innerHTML = response.submitted
    ? `<strong>${response.correct ? "回答正确" : "回答错误"} · 正确答案：${safeText(answer.join("、"))}</strong>${question.explanation ? `<p>${safeText(question.explanation)}</p>` : ""}`
    : "";

  elements.practiceQuestionList.innerHTML = state.questions.map((item, index) => {
    const itemResponse = practiceAnswer(item);
    return `<button type="button" class="practice-question-link${index === state.practiceIndex ? " active" : ""}${itemResponse.submitted ? itemResponse.correct ? " correct" : " incorrect" : ""}" data-index="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span><strong>${safeText(item.title || "未填写题干")}</strong>
    </button>`;
  }).join("");
  elements.practiceQuestionList.querySelectorAll(".practice-question-link").forEach((button) => {
    button.addEventListener("click", () => {
      state.practiceIndex = Number(button.dataset.index);
      renderPractice();
    });
  });
}

function startPractice() {
  if (!state.questions.length) return;
  if (state.questions.some((question) => !normalizeAnswers(question.answer).length)) {
    showToast("题库中还有未校对答案的题目，请先补全答案");
    return;
  }
  if (!state.activeId && hasUnsavedDraft() && !window.confirm("当前题目尚未保存，开始刷题前将放弃未保存的内容。是否继续？")) return;
  state.practiceIndex = 0;
  state.practiceAnswers = {};
  state.practiceMode = true;
  elements.practiceView.hidden = false;
  elements.practiceView.classList.add("active");
  document.body.classList.add("in-practice");
  renderPractice();
}

function stopPractice() {
  state.practiceMode = false;
  elements.practiceView.hidden = true;
  elements.practiceView.classList.remove("active");
  document.body.classList.remove("in-practice");
}

function renderImages() {
  const question = activeQuestion();
  const images = question?.images || [];
  elements.imageCount.textContent = String(images.length);
  elements.imageList.innerHTML = "";
  if (!images.length) {
    elements.imageList.innerHTML = '<div class="image-empty">框选左侧页面区域，将化学式、反应式或结构图添加到当前题目</div>';
    return;
  }
  images.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "image-card";
    card.innerHTML = `
      <img src="${image.dataUrl}" alt="题目图片 ${index + 1}" />
      <div class="image-card-footer"><span>第 ${image.page} 页 · 图片 ${index + 1}</span><button type="button" class="remove-image" data-index="${index}" aria-label="删除图片">移除</button></div>`;
    elements.imageList.append(card);
  });
  elements.imageList.querySelectorAll(".remove-image").forEach((button) => {
    button.addEventListener("click", () => {
      activeQuestion().images.splice(Number(button.dataset.index), 1);
      renderImages();
      if (state.activeId) schedulePersist();
    });
  });
}

function setDraftField(field, value) {
  const question = activeQuestion();
  if (question) question[field] = value;
  if (field === "type") elements.optionsField.hidden = value === "judge";
  if (state.activeId) schedulePersist();
}

async function viewQuestionSourcePage() {
  const page = Number(elements.questionPage.value);
  const question = activeQuestion();
  if (!question || !Number.isInteger(page) || page < 1) {
    showToast("请先填写有效的原 PDF 页码");
    return;
  }
  question.sourcePage = page;
  if (state.activeId) schedulePersist();
  if (!state.pdf || page > state.pageCount) {
    showToast("当前没有可查看的 PDF 页面，请确认页码或重新打开原 PDF");
    return;
  }
  await goToPage(page);
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error(`无法读取图片 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  const question = activeQuestion();
  if (!question) return;
  const images = [...files];
  const oversized = images.find((file) => file.size > 12 * 1024 * 1024);
  if (oversized) {
    showToast(`图片「${oversized.name}」超过 12 MB，请先压缩`);
    return;
  }
  try {
    for (const file of images) {
      if (!file.type.startsWith("image/")) {
        showToast(`「${file.name}」不是图片文件`);
        continue;
      }
      question.images.push({
        page: Number(question.sourcePage) || state.page || 1,
        dataUrl: await readImageFile(file),
      });
    }
    renderImages();
    if (images.length) schedulePersist();
  } catch (error) {
    console.error("[题目图片] 导入失败", error);
    showToast(`图片导入失败：${error.message || "请重试"}`);
  }
}

function addOption() {
  const question = activeQuestion();
  let keyCode = 65;
  while (question.options.some((option) => option.key === String.fromCharCode(keyCode)) && keyCode <= 90) {
    keyCode += 1;
  }
  if (keyCode > 90) {
    showToast("单题最多支持 26 个选项");
    return;
  }
  const key = String.fromCharCode(keyCode);
  question.options.push({ key, content: "" });
  renderOptions(question.options);
  if (state.activeId) schedulePersist();
  const inputs = elements.optionList.querySelectorAll(".option-input");
  inputs[inputs.length - 1]?.focus();
}

async function persistBank() {
  if (!state.questions.length) return false;
  const banks = await listBanks();
  const name = (state.bankName || state.fileName || "PDF 题库").replace(/\.pdf$/i, "").replace(/\.json$/i, "");
  const existing = state.bankId
    ? banks.find((bank) => bank.id === state.bankId)
    : banks.find((bank) => bank.source === "pdf" && bank.name === name);
  try {
    const saved = await saveBank({
      id: existing?.id,
      name,
      source: "pdf",
      fileName: state.fileName || "",
      questions: state.questions,
      progress: { practiceAnswers: state.practiceAnswers || {} },
    });
    state.bankId = saved.id;
    state.bankName = saved.name;
  } catch (error) {
    console.error("[题库] 保存失败", error);
    showToast("题库保存失败，请检查浏览器存储空间");
    await renderBankLibrary();
    return false;
  }
  await renderBankLibrary();
  renderQuestionList();
  return true;
}

function schedulePersist() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistBank, 700);
}

async function renderBankLibrary() {
  const banks = (await listBanks()).filter((bank) => bank.source === "pdf");
  elements.bankCount.textContent = String(banks.length);
  elements.bankList.innerHTML = banks.length
    ? banks
        .map(
          (bank) => `<div class="bank-item">
        <button class="bank-item-open" type="button" data-id="${safeText(bank.id)}">
          <span class="bank-item-main">
            <strong>${safeText(bank.name)}</strong>
            <small>${bank.questionCount} 题 · 保存于 ${safeText(formatSavedAt(bank.updatedAt))}</small>
          </span>
        </button>
        <button class="bank-item-delete" type="button" data-id="${safeText(bank.id)}" aria-label="删除题库 ${safeText(bank.name)}">删除</button>
      </div>`,
        )
        .join("")
    : '<div class="bank-empty">整理过的题目会自动保存在这里</div>';

  elements.bankList.querySelectorAll(".bank-item-open").forEach((button) => {
    button.addEventListener("click", () => openBank(button.dataset.id));
  });
  elements.bankList.querySelectorAll(".bank-item-delete").forEach((button) => {
    button.addEventListener("click", () => removeBankById(button.dataset.id, banks));
  });
}

async function removeBankById(id, knownBanks) {
  const banks = knownBanks?.length ? knownBanks : await listBanks();
  const bank = banks.find((item) => item.id === id);
  if (!window.confirm(`确定删除题库「${bank?.name || ""}」吗？删除后无法恢复。`)) return;
  await removeBank(id);
  if (state.bankId === id) {
    state.bankId = null;
    state.bankName = "";
    state.questions = [];
    state.practiceAnswers = {};
    state.activeId = null;
    state.draft = newQuestion();
    state.draft.sourcePage = state.page || 1;
    loadQuestion(state.draft);
    updateButtons();
  }
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
  const repaired = state.questions.filter(repairOptionsFromTitle).length;
  state.practiceAnswers = bank.progress?.practiceAnswers || {};
  state.fileName = bank.fileName || `${bank.name}.pdf`;
  state.activeId = null;
  state.draft = newQuestion();
  elements.fileCard.classList.remove("empty");
  elements.fileName.textContent = state.fileName;
  elements.documentMeta.textContent = `${state.questions.length} 题 · 来自本机题库`;
  loadQuestion(state.draft);
  updateButtons();
  if (repaired) await persistBank();
  showToast(repaired
    ? `已修复 ${repaired} 道题的选项拆分，请人工校对`
    : `已打开题库「${bank.name}」，可直接继续整理或刷题`);
}

async function saveQuestion() {
  const question = activeQuestion();
  question.title = elements.questionTitle.value.trim();
  question.answer = elements.questionAnswer.value.trim();
  question.explanation = elements.questionExplanation.value.trim();
  question.type = elements.questionType.value;
  if (!question.title) {
    showToast("请先填写题干");
    elements.questionTitle.focus();
    return;
  }
  if (!state.activeId) {
    question.id = crypto.randomUUID();
    state.questions.push(question);
    state.activeId = question.id;
  }
  elements.saveStatus.textContent = question.answer ? "已保存到题库 · 可继续校对" : "题目草稿已保存 · 答案待校对";
  renderQuestionList();
  renderImages();
  updateButtons();
  if (await persistBank()) showToast("题目已保存到题库");
}

function startNewQuestion() {
  if (!state.activeId && hasUnsavedDraft() && !window.confirm("当前新题目还没保存，确定放弃它并新建题目吗？")) {
    return;
  }
  state.activeId = null;
  state.draft = newQuestion();
  state.draft.sourcePage = state.page || 1;
  loadQuestion(state.draft);
  elements.questionTitle.focus();
}

function cropCoordinates(event) {
  const rect = elements.cropLayer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  };
}

function updateCropRect(endPoint) {
  const start = state.cropStart;
  if (!start) return;
  const left = Math.min(start.x, endPoint.x);
  const top = Math.min(start.y, endPoint.y);
  const width = Math.abs(endPoint.x - start.x);
  const height = Math.abs(endPoint.y - start.y);
  state.cropRect = { left, top, width, height };
  elements.cropLayer.style.setProperty("--crop-left", `${left}px`);
  elements.cropLayer.style.setProperty("--crop-top", `${top}px`);
  elements.cropLayer.style.setProperty("--crop-width", `${width}px`);
  elements.cropLayer.style.setProperty("--crop-height", `${height}px`);
  elements.cropLayer.classList.toggle("has-selection", width > 4 && height > 4);
  updateButtons();
}

function clearCrop() {
  state.cropStart = null;
  state.cropRect = null;
  elements.cropLayer.classList.remove("dragging", "has-selection");
  elements.cropLayer.style.removeProperty("--crop-left");
  elements.cropLayer.style.removeProperty("--crop-top");
  elements.cropLayer.style.removeProperty("--crop-width");
  elements.cropLayer.style.removeProperty("--crop-height");
  updateButtons();
}

function setCropMode(active) {
  state.cropMode = active;
  elements.cropLayer.classList.toggle("crop-mode", active);
  if (!active) clearCrop();
  else {
    elements.pageHint.textContent = "截图模式已开启：在 PDF 页面拖动框选图片区域";
    updateButtons();
  }
}

function saveCrop() {
  const rect = state.cropRect;
  if (!rect || !state.pdf || rect.width < 12 || rect.height < 12) {
    clearCrop();
    return;
  }
  const bounds = elements.canvas.getBoundingClientRect();
  const ratioX = elements.canvas.width / bounds.width;
  const ratioY = elements.canvas.height / bounds.height;
  const sourceX = Math.max(0, Math.floor(rect.left * ratioX));
  const sourceY = Math.max(0, Math.floor(rect.top * ratioY));
  const sourceWidth = Math.min(elements.canvas.width - sourceX, Math.ceil(rect.width * ratioX));
  const sourceHeight = Math.min(elements.canvas.height - sourceY, Math.ceil(rect.height * ratioY));
  const crop = document.createElement("canvas");
  crop.width = sourceWidth;
  crop.height = sourceHeight;
  crop.getContext("2d").drawImage(
    elements.canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  activeQuestion().images.push({ page: state.page, dataUrl: crop.toDataURL("image/png") });
  setCropMode(false);
  clearCrop();
  renderImages();
  schedulePersist();
  showToast("页面截图已添加到当前题目");
}

function renderOcrStatus(message) {
  elements.pageHint.textContent = message;
}

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  return formatElapsed(ms);
}

function renderOcrLog() {
  const { logs } = state.ocrRun;
  elements.ocrLog.innerHTML = "";
  if (!logs.length) {
    elements.ocrLog.innerHTML = '<div class="ocr-log-empty">运行 OCR 后会记录模型加载、PDF 渲染和识别耗时。</div>';
  } else {
    logs.slice(-12).forEach((entry) => {
      const row = document.createElement("div");
      row.className = `ocr-log-entry${entry.error ? " error" : ""}`;
      const time = document.createElement("span");
      time.className = "ocr-log-time";
      time.textContent = entry.time;
      const message = document.createElement("span");
      message.className = "ocr-log-message";
      message.textContent = entry.message;
      row.append(time, message);
      elements.ocrLog.append(row);
    });
    elements.ocrLog.scrollTop = elements.ocrLog.scrollHeight;
  }
  elements.copyOcrLog.disabled = logs.length === 0;
}

function addOcrLog(message, { error = false, consoleLog = true } = {}) {
  const elapsed = formatElapsed(performance.now() - state.ocrRun.startedAt);
  state.ocrRun.logs.push({ time: elapsed, message, error });
  if (state.ocrRun.logs.length > 80) state.ocrRun.logs.shift();
  renderOcrLog();
  if (consoleLog) {
    (error ? console.error : console.info)(`[OCR +${elapsed}] ${message}`);
  }
}

function setOcrPhase(phase, { log = true } = {}) {
  state.ocrRun.phase = phase;
  state.ocrRun.lastEventAt = performance.now();
  elements.ocrStatus.textContent = phase;
  elements.ocrPhase.textContent = state.ocrRun.active ? `当前阶段：${phase}` : phase;
  elements.ocrStateDot.classList.toggle("active", state.ocrRun.active);
  if (state.busy) setBusy(true, phase);
  if (log) addOcrLog(phase);
}

function setOcrProgress(progress) {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  state.ocrRun.progress = value;
  elements.ocrProgress.style.width = `${value}%`;
  elements.ocrProgress.classList.toggle("indeterminate", value === 0 && state.ocrRun.active);
}

function startOcrMonitor() {
  clearInterval(state.ocrRun.timer);
  Object.assign(state.ocrRun, {
    active: true,
    startedAt: performance.now(),
    lastEventAt: performance.now(),
    lastHeartbeatAt: performance.now(),
    phase: "",
    progress: 0,
    logs: [],
    lastLoggedStatus: "",
    lastLoggedProgress: -1,
  });
  setOcrProgress(0);
  renderOcrLog();
  elements.ocrElapsed.textContent = "00:00";
  elements.ocrStateDot.classList.add("active");
  state.ocrRun.timer = setInterval(() => {
    const now = performance.now();
    elements.ocrElapsed.textContent = formatElapsed(now - state.ocrRun.startedAt);
    if (
      now - state.ocrRun.lastEventAt >= 15000 &&
      now - state.ocrRun.lastHeartbeatAt >= 30000
    ) {
      state.ocrRun.lastHeartbeatAt = now;
      addOcrLog(`已等待 ${formatElapsed(now - state.ocrRun.startedAt)}；“${state.ocrRun.phase}”尚无新进度，任务仍在等待返回。`, {
        consoleLog: false,
      });
      elements.ocrStatus.textContent = `等待响应 · ${state.ocrRun.phase}`;
    }
  }, 1000);
}

function stopOcrMonitor(finalStatus, { error = false } = {}) {
  clearInterval(state.ocrRun.timer);
  state.ocrRun.timer = null;
  state.ocrRun.active = false;
  const elapsed = formatElapsed(performance.now() - state.ocrRun.startedAt);
  elements.ocrElapsed.textContent = elapsed;
  elements.ocrStatus.textContent = finalStatus;
  elements.ocrPhase.textContent = `本次耗时 ${elapsed}`;
  elements.ocrStateDot.classList.remove("active");
  elements.ocrStateDot.classList.toggle("error", error);
  elements.ocrProgress.classList.remove("indeterminate");
  if (!error) setOcrProgress(100);
  renderOcrLog();
}

async function copyOcrLog() {
  if (!state.ocrRun.logs.length) return;
  const text = state.ocrRun.logs.map((entry) => `[+${entry.time}] ${entry.message}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast("OCR 运行日志已复制");
  } catch (error) {
    console.error("[OCR] 复制日志失败", error);
    showToast("复制失败，请确认浏览器允许访问剪贴板");
  }
}

function handleTesseractLog(message, pageNumber) {
  const statusLabels = {
    "loading tesseract core": "加载 OCR 引擎核心",
    "initializing tesseract": "初始化 OCR 引擎",
    "loading language traineddata": "加载简体中文模型",
    "initializing api": "初始化中文识别器",
    "recognizing text": `识别第 ${state.ocrRun.pageNumber || pageNumber} 页文字`,
  };
  const label = statusLabels[message.status] || `OCR：${message.status}`;
  const percent = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : 0;
  const changedStatus = message.status !== state.ocrRun.lastLoggedStatus;
  const meaningfulProgress =
    message.status === "recognizing text" &&
    (percent === 100 || percent >= state.ocrRun.lastLoggedProgress + 10);

  if (changedStatus || meaningfulProgress) {
    state.ocrRun.lastLoggedStatus = message.status;
    if (message.status === "recognizing text") state.ocrRun.lastLoggedProgress = percent;
    setOcrPhase(meaningfulProgress ? `${label} · ${percent}%` : label);
  } else {
    state.ocrRun.lastEventAt = performance.now();
  }

  if (message.status === "recognizing text") setOcrProgress(percent);
}

async function ensureOcrWorker(pageNumber) {
  state.ocrRun.pageNumber = pageNumber;
  if (state.worker) return;
  const engineStartedAt = performance.now();
  setOcrPhase("准备 OCR 引擎与简体中文模型");
  state.worker = await createWorker("chi_sim", OEM.LSTM_ONLY, {
    workerPath: tesseractWorkerUrl,
    corePath: tesseractCoreUrl,
    langPath: `${import.meta.env.BASE_URL}tessdata`,
    gzip: true,
    cacheMethod: "write",
    logger: (message) => handleTesseractLog(message, state.ocrRun.pageNumber),
  });
  addOcrLog(`OCR 引擎与模型就绪，用时 ${formatDuration(performance.now() - engineStartedAt)}。`);
  await state.worker.setParameters({ preserve_interword_spaces: "1" });
}

async function extractEmbeddedPageText(page) {
  const content = await page.getTextContent();
  const lines = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str?.trim()) continue;
    const y = item.transform?.[5] || 0;
    const x = item.transform?.[4] || 0;
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - y) > 2.5) {
      line = { y, text: "", lastRight: x, fontSize: Math.abs(item.transform?.[0] || 0) };
      lines.push(line);
    }
    const gap = x - line.lastRight;
    if (line.text && gap > Math.max(2, line.fontSize * 0.3)) line.text += " ";
    line.text += item.str.trim();
    line.lastRight = x + (item.width || 0);
  }
  return lines.map((line) => line.text.trim()).filter(Boolean).join("\n");
}

async function recognizePage(pageNumber, index, total) {
  state.ocrRun.pageNumber = pageNumber;
  setOcrPhase(total > 1 ? `读取第 ${pageNumber} / ${total} 页` : `读取第 ${pageNumber} 页`);
  const pageStartedAt = performance.now();
  const page = await state.pdf.getPage(pageNumber);
  const embeddedText = await extractEmbeddedPageText(page);
  if (embeddedText.length >= 25) {
    addOcrLog(`第 ${pageNumber} 页直接提取到 ${embeddedText.length} 个 PDF 文本字符，跳过 OCR。`);
    setOcrProgress(total > 1 ? Math.round(((index + 1) / total) * 100) : 100);
    return { text: embeddedText, method: "pdf-text" };
  }

  addOcrLog(`第 ${pageNumber} 页 PDF 内嵌文字不足，改用本机 OCR。`);
  await ensureOcrWorker(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const ocrCanvas = document.createElement("canvas");
  const ocrScale = Math.min(2.5, Math.max(1.8, 1800 / baseViewport.width));
  const viewport = page.getViewport({ scale: ocrScale });
  ocrCanvas.width = Math.ceil(viewport.width);
  ocrCanvas.height = Math.ceil(viewport.height);
  setOcrPhase(`渲染第 ${pageNumber} 页 · ${ocrCanvas.width} × ${ocrCanvas.height}`);
  await page.render({ canvas: ocrCanvas, viewport }).promise;
  addOcrLog(`第 ${pageNumber} 页渲染完成，用时 ${formatDuration(performance.now() - pageStartedAt)}。`);

  const recognitionStartedAt = performance.now();
  state.ocrRun.lastLoggedProgress = -1;
  state.ocrRun.lastLoggedStatus = "";
  setOcrProgress(total > 1 ? Math.round((index / total) * 100) : 0);
  setOcrPhase(`开始识别第 ${pageNumber} 页`);
  setBusy(true, `正在识别第 ${pageNumber} / ${total} 页…`);
  const { data } = await state.worker.recognize(ocrCanvas);
  addOcrLog(`第 ${pageNumber} 页识别返回，用时 ${formatDuration(performance.now() - recognitionStartedAt)}。`);
  return { text: String(data.text || "").trim(), method: "ocr" };
}

function splitOcrQuestions(pageText, pageNumber) {
  const starts = [...pageText.matchAll(/^\s*(?:第\s*)?(\d{1,3})\s*[.．、)）:：]\s*(.*)$/gm)];
  const segments = starts.length
    ? starts.map((start, index) => {
        const begin = start.index;
        const end = starts[index + 1]?.index ?? pageText.length;
        return pageText.slice(begin, end).replace(/^\s*(?:第\s*)?\d{1,3}\s*[.．、)）:：]\s*/, "").trim();
      }).filter(Boolean)
    : [pageText.trim()].filter(Boolean);

  return segments.map((segment) => {
    const { title, options } = splitOcrOptions(segment);

    return {
      ...newQuestion(),
      title: title || segment,
      options: options.length ? options : newQuestion().options,
      sourcePage: pageNumber,
      reviewed: false,
    };
  });
}

function splitOcrPages(pages) {
  const sectionHeading = /^\s*(?:第\s*)?[一二三四五六七八九十百]+(?:部分|章|节)?\s*[、.．:：]\s*\S.*$/;
  const questionStart = /^\s*(?:第\s*)?(\d{1,3})\s*[.．、)）:：]\s*(.*)$/;
  const questions = [];
  let sectionLines = [];
  let sectionContext = "";
  let sectionHasQuestions = false;
  let current = null;

  const finishQuestion = () => {
    if (!current) return;
    const parsed = splitOcrOptions(current.lines.join("\n").trim());
    const title = [current.sectionContext, parsed.title].filter(Boolean).join("\n");
    if (title.trim()) {
      questions.push({
        ...newQuestion(),
        title,
        options: parsed.options.length ? parsed.options : newQuestion().options,
        sourcePage: current.pageNumber,
        reviewed: false,
      });
    }
    current = null;
  };

  for (const { pageNumber, text } of pages) {
    for (const line of text.split(/\r?\n/)) {
      const normalizedLine = line.trim();
      if (!normalizedLine) {
        if (current) current.lines.push("");
        else if (sectionLines.length) sectionLines.push("");
        continue;
      }

      if (sectionHeading.test(normalizedLine)) {
        finishQuestion();
        sectionLines = [normalizedLine];
        sectionContext = "";
        sectionHasQuestions = false;
        continue;
      }

      const match = normalizedLine.match(questionStart);
      if (match) {
        finishQuestion();
        if (sectionLines.length && !sectionHasQuestions) {
          sectionContext = sectionLines.join("\n").trim();
        }
        if (sectionLines.length) sectionHasQuestions = true;
        sectionLines = [];
        current = {
          pageNumber,
          sectionContext: sectionContext,
          lines: [match[2]],
        };
      } else if (current) {
        current.lines.push(normalizedLine);
      } else if (sectionLines.length && !sectionHasQuestions) {
        sectionLines.push(normalizedLine);
      }
    }
  }
  finishQuestion();

  return questions.length
    ? questions
    : pages.flatMap(({ pageNumber, text }) => splitOcrQuestions(text, pageNumber));
}

function splitOcrOptions(segment) {
  const optionMatches = [...segment.matchAll(/(?:^|[\s，,。！？;；：:])([A-F])(?:[.．、:：)）]+|[,，]\s*[.．]|\s)\s*/g)];
  const markerStarts = optionMatches.map((match) => match.index + match[0].lastIndexOf(match[1]));
  const firstOption = markerStarts[0];
  const title = (firstOption === undefined ? segment : segment.slice(0, firstOption)).trim();
  const options = optionMatches.map((match, index) => {
    const contentStart = match.index + match[0].length;
    const contentEnd = markerStarts[index + 1] ?? segment.length;
    return {
      key: match[1],
      content: segment.slice(contentStart, contentEnd).trim().replace(/\s+/g, " ").replace(/[,，]$/, ""),
    };
  }).filter((option) => option.content);
  return { title, options };
}

async function renderPageCanvas(pageNumber) {
  const page = await state.pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, Math.max(1, 1400 / baseViewport.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function runVision({ allPages = false } = {}) {
  if (!state.pdf || state.busy) return;
  const settings = loadVisionSettings();
  if (!settings.apiKey) {
    openVisionSettings(true);
    showToast("请先在「视觉 AI 设置」中填写 API Key");
    return;
  }

  const pageNumbers = allPages
    ? Array.from({ length: state.pageCount }, (_, index) => index + 1)
    : [state.page];

  if (allPages) {
    if (state.questions.length &&
        !window.confirm("AI 识别整份试卷会用 AI 草稿替换当前题目和人工校对结果，确定继续吗？")) {
      return;
    }
  } else {
    const reviewed = state.questions.filter(
      (question) => Number(question.sourcePage) === state.page && question.reviewed,
    );
    if (reviewed.length &&
        !window.confirm(`第 ${state.page} 页已有 ${reviewed.length} 道校对过的题目，AI 识别会替换本页题目，确定继续吗？`)) {
      return;
    }
  }

  let failed = false;
  startOcrMonitor();
  try {
    setBusy(true, "正在调用视觉 AI…");
    renderOcrStatus(allPages ? "正在用视觉 AI 识别全部页面…" : "正在用视觉 AI 识别当前页面…");
    const startedAt = performance.now();
    const pages = await mapWithConcurrency(pageNumbers, 2, async (pageNumber, index) => {
      setOcrPhase(`第 ${pageNumber} / ${pageNumbers.length} 页 · 生成页面图片`);
      const canvas = await renderPageCanvas(pageNumber);
      const imageDataUrl = canvasToJpegDataUrl(canvas, { maxWidth: 1280, quality: 0.75 });
      setOcrPhase(`第 ${pageNumber} / ${pageNumbers.length} 页 · 等待模型返回`);
      const payload = await requestVisionJson({ imageDataUrl, prompt: VISION_PROMPT, settings });
      const items = visionQuestionsFromPayload(payload, pageNumber);
      addOcrLog(`第 ${pageNumber} 页返回 ${items.length} 道题 · 图片约 ${Math.round(imageDataUrl.length / 1024)} KB`);
      setOcrProgress(Math.round(((index + 1) / pageNumbers.length) * 100));
      return items;
    });

    const created = pages.flat();
    if (!created.length) {
      setOcrPhase("视觉 AI 未识别出题目");
      renderOcrStatus("AI 没有在这些页面识别出题目，可先放大页面或改用 OCR");
      showToast("AI 没有识别出题目");
      return;
    }
    created.forEach((question) => {
      question.id = crypto.randomUUID();
    });

    if (allPages) {
      state.questions = created;
      state.activeId = null;
      state.draft = newQuestion();
      state.bankId = null;
      state.bankName = state.fileName.replace(/\.pdf$/i, "");
      state.practiceAnswers = {};
    } else {
      const kept = state.questions.filter((question) => Number(question.sourcePage) !== state.page);
      if (!kept.some((question) => question.id === state.activeId)) {
        state.activeId = null;
        state.draft = newQuestion();
      }
      state.questions = [...kept, ...created].sort(
        (left, right) => (Number(left.sourcePage) || 0) - (Number(right.sourcePage) || 0),
      );
    }

    renderQuestionList();
    loadQuestion(created[0]);
    const saved = await persistBank();
    const elapsed = formatDuration(performance.now() - startedAt);
    elements.documentMeta.textContent = `${formatBytes(state.fileSize)} · ${state.pageCount} 页 · AI 已生成 ${created.length} 道待校对题目`;
    elements.pageHint.textContent = `AI 生成 ${created.length} 道题，用时 ${elapsed}；逐题核对后点「确认并下一题」`;
    setOcrPhase(`AI 识别完成 · ${created.length} 道题`);
    showToast(saved
      ? `AI 已生成 ${created.length} 道待校对题目，用时 ${elapsed}`
      : `AI 已生成 ${created.length} 道题，但题库保存失败，请检查浏览器存储`);
  } catch (error) {
    failed = true;
    console.error("[视觉 AI] 识别失败", error?.stack || String(error));
    addOcrLog(`视觉 AI 失败：${error.message || String(error)}`, { error });
    renderOcrStatus("视觉 AI 调用失败，请检查接口地址、模型名与 API Key");
    showToast(`视觉 AI 失败：${error.message || "请重试"}`);
  } finally {
    stopOcrMonitor(failed ? "视觉 AI 失败" : elements.ocrStatus.textContent, { error: failed });
    setBusy(false);
  }
}

function setVisionSettingsOpen(open) {
  elements.aiSettingsBody.hidden = !open;
  elements.aiSettingsToggle.setAttribute("aria-expanded", String(open));
  elements.aiSettingsToggle.classList.toggle("open", open);
}

function openVisionSettings(open = true) {
  setVisionSettingsOpen(open);
  if (open) elements.aiApiKey.focus();
}

function renderVisionSettings() {
  const settings = loadVisionSettings();
  elements.aiPreset.innerHTML = VISION_PRESETS
    .map((preset) => `<option value="${safeText(preset.id)}">${safeText(preset.label)}</option>`)
    .join("");
  const preset = visionPresetOf(settings);
  elements.aiPreset.value = preset?.id || "custom";
  elements.aiBaseUrl.value = settings.baseUrl;
  elements.aiModel.value = settings.model;
  elements.aiApiKey.value = settings.apiKey;
  elements.aiSettingsHint.textContent = preset?.note
    ? `${preset.note}。Key 只保存在本机浏览器。`
    : "Key 只保存在本机浏览器；免费额度与模型可用性以各家控制台为准。";
}

async function fetchModelOptions() {
  elements.aiFetchModels.disabled = true;
  try {
    const ids = await fetchVisionModels({
      baseUrl: elements.aiBaseUrl.value,
      apiKey: elements.aiApiKey.value,
    });
    elements.aiModelOptions.innerHTML = ids
      .map((id) => `<option value="${safeText(id)}"></option>`)
      .join("");
    showToast(`已获取 ${ids.length} 个可用模型，可在模型框中下拉选择`);
  } catch (error) {
    console.error("[视觉 AI] 拉取模型失败", error?.stack || String(error));
    showToast(error.message || "拉取模型失败");
  } finally {
    elements.aiFetchModels.disabled = false;
  }
}

function saveVisionSettingsFromInputs() {
  saveVisionSettings({
    baseUrl: elements.aiBaseUrl.value,
    model: elements.aiModel.value,
    apiKey: elements.aiApiKey.value,
  });
  renderVisionSettings();
  showToast("视觉 AI 设置已保存到本机");
}

async function testVision() {
  elements.aiTestConnection.disabled = true;
  try {
    await testVisionConnection({
      baseUrl: elements.aiBaseUrl.value,
      model: elements.aiModel.value,
      apiKey: elements.aiApiKey.value,
    });
    showToast("接口可用，可以开始 AI 识别");
  } catch (error) {
    console.error("[视觉 AI] 连接测试失败", error?.stack || String(error));
    showToast(`连接失败：${error.message || "请检查接口设置"}`);
  } finally {
    elements.aiTestConnection.disabled = false;
  }
}

async function runOcr({ allPages = false, confirmReplace = false } = {}) {
  if (!state.pdf || state.busy) return;
  if (allPages && confirmReplace && state.questions.length &&
      !window.confirm("重新识别整份试卷会替换当前题库中的题目及人工校对内容，确定继续吗？")) {
    return;
  }
  const firstPage = state.page;
  const pageNumbers = allPages
    ? Array.from({ length: state.pageCount }, (_, index) => index + 1)
    : [state.page];
  let failed = false;
  startOcrMonitor();
  try {
    setBusy(true, "正在准备中文 OCR…");
    renderOcrStatus(allPages ? "正在自动识别 PDF 全部页面并生成可校对题目…" : "正在识别当前页面…");
    await ensureOcrWorker(firstPage);
    const recognized = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      const result = await recognizePage(pageNumber, index, pageNumbers.length);
      if (result.text) recognized.push({ pageNumber, text: result.text, method: result.method });
      else addOcrLog(`第 ${pageNumber} 页未识别到文字。`);
    }

    if (allPages) {
      if (!recognized.length) {
        setOcrPhase("识别结束：没有页面提取到文字");
        renderOcrStatus("没有识别到文字，请检查扫描质量或页面方向");
        showToast("未能从 PDF 中识别文字");
        return;
      }
      state.questions = splitOcrPages(recognized);
      state.activeId = null;
      state.questions.forEach((question) => {
        question.id = crypto.randomUUID();
      });
      state.bankId = null;
      state.bankName = state.fileName.replace(/\.pdf$/i, "");
      state.practiceAnswers = {};
      renderQuestionList();
      loadQuestion(state.questions[0]);
      const saved = await persistBank();
      elements.documentMeta.textContent = `${formatBytes(state.fileSize)} · ${state.pageCount} 页 · 已识别 ${state.questions.length} 道待校对题目`;
      elements.pageHint.textContent = `已识别 ${recognized.length} 页并生成 ${state.questions.length} 道题；点击题目可校对，缺失选项/答案请人工补全`;
      setOcrPhase(`题库草稿已生成 · ${state.questions.length} 道题`);
      showToast(saved
        ? `自动识别完成，已生成并保存 ${state.questions.length} 道待校对题目`
        : `已生成 ${state.questions.length} 道题，但题库保存失败，请检查浏览器存储`);
    } else {
      const pageResult = recognized.find((item) => item.pageNumber === firstPage);
      if (!pageResult) {
        setOcrPhase("识别结束：本页没有提取到文字");
        renderOcrStatus(`第 ${firstPage} 页没有提取到文字；请检查页面内容与扫描清晰度`);
        showToast("本页没有识别出文字；扫描质量或页面方向可能影响结果");
        return;
      }
      const replacement = elements.questionTitle.value.trim()
        ? `${elements.questionTitle.value.trim()}\n${pageResult.text}`
        : pageResult.text;
      elements.questionTitle.value = replacement;
      setDraftField("title", replacement);
      elements.questionPage.value = String(firstPage);
      setDraftField("sourcePage", firstPage);
      elements.pageHint.textContent = `第 ${firstPage} 页识别完成 · ${pageResult.text.length} 个字符，请人工校对`;
      setOcrPhase(`识别完成 · ${pageResult.text.length} 个字符`);
      showToast(`识别完成，提取约 ${pageResult.text.length} 个字符`);
    }
  } catch (error) {
    failed = true;
    console.error("[OCR] 识别失败", error?.stack || String(error));
    addOcrLog(`识别失败：${error.message || String(error)}`, { error });
    renderOcrStatus("OCR 失败，请检查模型文件和本机浏览器控制台");
    showToast(`OCR 失败：${error.message || "请重试"}`);
  } finally {
    stopOcrMonitor(failed ? "OCR 失败" : elements.ocrStatus.textContent, { error: failed });
    setBusy(false);
  }
}

function exportBank() {
  if (!state.questions.length) return;
  const count = downloadBankFile({
    name: state.bankName || state.fileName.replace(/\.pdf$/i, "") || "化学题库",
    source: "pdf",
    questions: state.questions,
  });
  showToast(`已导出 ${count} 道题到下载目录`);
}

async function importBankFile(file) {
  const bank = await readBankFile(file);
  state.bankId = null;
  state.bankName = bank.name;
  state.questions = toPdfQuestions(bank.questions);
  state.practiceAnswers = {};
  state.activeId = null;
  state.draft = newQuestion();
  state.fileName = `${bank.name}.json`;
  elements.fileCard.classList.remove("empty");
  elements.fileName.textContent = state.fileName;
  elements.documentMeta.textContent = `${state.questions.length} 题 · 来自导入的题库文件`;
  loadQuestion(state.draft);
  updateButtons();
  await persistBank();
  showToast(`已导入 ${state.questions.length} 道题`);
}

elements.startPractice.addEventListener("click", startPractice);
elements.practiceClose.addEventListener("click", stopPractice);
elements.practiceRestart.addEventListener("click", () => {
  state.practiceAnswers = {};
  state.practiceIndex = 0;
  renderPractice();
});
elements.practicePrevious.addEventListener("click", () => {
  if (state.practiceIndex > 0) {
    state.practiceIndex -= 1;
    renderPractice();
  }
});
elements.practiceNext.addEventListener("click", () => {
  if (state.practiceIndex < state.questions.length - 1) {
    state.practiceIndex += 1;
    renderPractice();
  }
});
elements.practiceSubmit.addEventListener("click", () => {
  const question = state.questions[state.practiceIndex];
  if (!normalizeAnswers(question.answer).length) {
    showToast("这道题还没有校对正确答案");
    return;
  }
  const response = practiceAnswer(question);
  if (!response.selected.length) {
    showToast("请先选择答案");
    return;
  }
  const expected = normalizeAnswers(question.answer);
  const actual = [...response.selected].sort();
  response.submitted = true;
  response.correct = actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  renderPractice();
  schedulePersist();
});

elements.input.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (files.length) await openPdfFiles(files);
});
elements.prevPage.addEventListener("click", () => goToPage(state.page - 1));
elements.nextPage.addEventListener("click", () => goToPage(state.page + 1));
elements.zoomIn.addEventListener("click", () => {
  state.zoom = Math.min(2.5, Number((state.zoom + 0.15).toFixed(2)));
  goToPage(state.page);
});
elements.zoomOut.addEventListener("click", () => {
  state.zoom = Math.max(0.75, Number((state.zoom - 0.15).toFixed(2)));
  goToPage(state.page);
});
elements.screenshotMode.addEventListener("click", () => setCropMode(!state.cropMode));
elements.clearCrop.addEventListener("click", clearCrop);
elements.cropLayer.addEventListener("pointerdown", (event) => {
  if (!state.pdf || state.busy || !state.cropMode) return;
  state.cropStart = cropCoordinates(event);
  elements.cropLayer.classList.add("dragging");
  elements.cropLayer.setPointerCapture(event.pointerId);
  updateCropRect(state.cropStart);
});
elements.cropLayer.addEventListener("pointermove", (event) => {
  if (state.cropStart) updateCropRect(cropCoordinates(event));
});
elements.cropLayer.addEventListener("pointerup", (event) => {
  if (!state.cropStart) return;
  updateCropRect(cropCoordinates(event));
  elements.cropLayer.classList.remove("dragging");
  state.cropStart = null;
  saveCrop();
});
elements.cropLayer.addEventListener("pointercancel", clearCrop);
elements.runOcr.addEventListener("click", runOcr);
elements.rerunAllOcr.addEventListener("click", () => runOcr({ allPages: true, confirmReplace: true }));
elements.aiRecognizePage.addEventListener("click", () => runVision());
elements.aiRecognizeAll.addEventListener("click", () => runVision({ allPages: true }));
elements.aiSettingsToggle.addEventListener("click", () => setVisionSettingsOpen(elements.aiSettingsBody.hidden));
elements.aiSaveSettings.addEventListener("click", saveVisionSettingsFromInputs);
elements.aiTestConnection.addEventListener("click", testVision);
elements.aiFetchModels.addEventListener("click", fetchModelOptions);
elements.aiPreset.addEventListener("change", () => {
  const preset = VISION_PRESETS.find((item) => item.id === elements.aiPreset.value);
  if (!preset) return;
  if (preset.id === "custom") {
    elements.aiSettingsHint.textContent = "填写任意 OpenAI 兼容的接口地址与视觉模型名即可。";
    return;
  }
  elements.aiBaseUrl.value = preset.baseUrl;
  elements.aiModel.value = preset.model;
  elements.aiSettingsHint.textContent = `${preset.note}。填好 API Key 后点「保存设置」。`;
});
elements.copyOcrLog.addEventListener("click", copyOcrLog);
elements.questionType.addEventListener("change", () => setDraftField("type", elements.questionType.value));
elements.questionPage.addEventListener("input", () => {
  const page = Number(elements.questionPage.value);
  setDraftField("sourcePage", Number.isInteger(page) && page > 0 ? page : "");
  schedulePersist();
});
elements.viewQuestionPage.addEventListener("click", viewQuestionSourcePage);
elements.questionTitle.addEventListener("input", () => setDraftField("title", elements.questionTitle.value));
elements.questionAnswer.addEventListener("input", () => setDraftField("answer", elements.questionAnswer.value));
elements.questionExplanation.addEventListener("input", () => setDraftField("explanation", elements.questionExplanation.value));
elements.addOption.addEventListener("click", addOption);
elements.saveQuestion.addEventListener("click", saveQuestion);
elements.newQuestion.addEventListener("click", startNewQuestion);
elements.previousQuestion.addEventListener("click", () => moveQuestion(-1));
elements.nextQuestion.addEventListener("click", () => moveQuestion(1));
elements.confirmQuestion.addEventListener("click", confirmQuestion);
elements.questionImageInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  await addImageFiles(files);
});
elements.exportJson.addEventListener("click", exportBank);
elements.bankInput.addEventListener("change", async (event) => {
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
window.addEventListener("beforeunload", () => {
  if (state.worker) state.worker.terminate();
  if (state.pdf) state.pdf.destroy();
});

renderOptions(state.draft.options);
loadQuestion(state.draft);
updateButtons();
renderBankLibrary();
renderVisionSettings();
ensurePersistence();
