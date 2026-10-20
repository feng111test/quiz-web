import "./styles.css";
import { ensurePersistence, formatSavedAt, listBanks } from "../../src/question-bank.js";
import { escapeHtml, renderFormulaContent } from "../../src/question-text.js";
import { sameAnswer, shuffle, toQuizQuestions } from "../../src/quiz-model.js";
import {
  applyCorrections,
  clearCorrection,
  getCorrection,
  saveCorrection,
} from "../../src/question-correction.js";

document.documentElement.classList.toggle("embedded", new URLSearchParams(location.search).has("embedded"));

const SESSION_KEY = "exam-workspace:quiz:session";
const PROGRESS_KEY = "exam-workspace:quiz:progress";
const SETTINGS_KEY = "exam-workspace:quiz:settings";
const SCOPES = ["all", "unanswered", "wrong", "flagged"];

const byId = (id) => document.getElementById(id);
const ui = {
  setupView: byId("setupView"),
  practiceView: byId("practiceView"),
  statBanks: byId("statBanks"),
  statQuestions: byId("statQuestions"),
  statSelected: byId("statSelected"),
  sourceChips: byId("sourceChips"),
  bankList: byId("bankList"),
  bankEmpty: byId("bankEmpty"),
  selectAll: byId("selectAll"),
  selectNone: byId("selectNone"),
  orderModes: byId("orderModes"),
  scopeModes: byId("scopeModes"),
  autoNext: byId("autoNext"),
  pickSummary: byId("pickSummary"),
  startPractice: byId("startPractice"),
  practiceTitle: byId("practiceTitle"),
  practiceProgress: byId("practiceProgress"),
  progressBar: byId("progressBar"),
  practiceRestart: byId("practiceRestart"),
  practiceExit: byId("practiceExit"),
  practiceAgain: byId("practiceAgain"),
  practiceWrongOnly: byId("practiceWrongOnly"),
  finishCard: byId("finishCard"),
  finishSummary: byId("finishSummary"),
  navList: byId("navList"),
  qNumber: byId("qNumber"),
  qBank: byId("qBank"),
  qType: byId("qType"),
  qCorrected: byId("qCorrected"),
  correctButton: byId("correctButton"),
  correctView: byId("correctView"),
  correctHeading: byId("correctHeading"),
  correctClose: byId("correctClose"),
  correctType: byId("correctType"),
  correctTitle: byId("correctTitle"),
  correctOptions: byId("correctOptions"),
  correctAddOption: byId("correctAddOption"),
  correctExplanation: byId("correctExplanation"),
  correctReset: byId("correctReset"),
  correctCancel: byId("correctCancel"),
  correctSave: byId("correctSave"),
  qTitle: byId("qTitle"),
  qImages: byId("qImages"),
  qOptions: byId("qOptions"),
  qFeedback: byId("qFeedback"),
  flagButton: byId("flagButton"),
  prevButton: byId("prevButton"),
  nextButton: byId("nextButton"),
  submitButton: byId("submitButton"),
  toast: byId("toast"),
};

const state = {
  banks: [],
  selected: new Set(),
  bankFilter: "all",
  settings: { random: false, scope: "all", autoNext: false },
  pool: [],
  poolBankIds: [],
  index: 0,
  correcting: null,
  responses: new Map(),
  selectionReady: false,
  toastTimer: null,
  progressTimer: null,
  sessionTimer: null,
};

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 3000);
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("[刷题] 读取本地记录失败", error);
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("[刷题] 保存本地记录失败", error);
  }
}

function responseFor(question) {
  if (!state.responses.has(question.uid)) {
    state.responses.set(question.uid, { selected: [], submitted: false, correct: false, flagged: false });
  }
  return state.responses.get(question.uid);
}

function loadProgress() {
  const saved = readStore(PROGRESS_KEY, {});
  state.responses.clear();
  Object.entries(saved && typeof saved === "object" ? saved : {}).forEach(([bankId, items]) => {
    Object.entries(items && typeof items === "object" ? items : {}).forEach(([questionId, value]) => {
      if (!value || typeof value !== "object") return;
      state.responses.set(`${bankId}::${questionId}`, {
        selected: Array.isArray(value.selected) ? value.selected.map(String) : [],
        submitted: Boolean(value.submitted),
        correct: Boolean(value.correct),
        flagged: Boolean(value.flagged),
      });
    });
  });
}

function writeProgress() {
  const grouped = {};
  state.responses.forEach((value, uid) => {
    if (!value.submitted && !value.flagged && !value.selected.length) return;
    const splitAt = uid.indexOf("::");
    if (splitAt < 0) return;
    const bankId = uid.slice(0, splitAt);
    const questionId = uid.slice(splitAt + 2);
    if (!grouped[bankId]) grouped[bankId] = {};
    grouped[bankId][questionId] = {
      selected: value.selected,
      submitted: value.submitted,
      correct: value.correct,
      flagged: value.flagged,
    };
  });
  writeStore(PROGRESS_KEY, grouped);
}

function saveProgress() {
  clearTimeout(state.progressTimer);
  state.progressTimer = setTimeout(writeProgress, 400);
}

function writeSession() {
  writeStore(SESSION_KEY, {
    bankIds: state.poolBankIds,
    random: state.settings.random,
    scope: state.settings.scope,
    order: state.pool.map((question) => question.uid),
    index: state.index,
  });
}

function saveSession() {
  clearTimeout(state.sessionTimer);
  state.sessionTimer = setTimeout(writeSession, 400);
}

function flushRecords() {
  clearTimeout(state.progressTimer);
  clearTimeout(state.sessionTimer);
  writeProgress();
  if (state.pool.length) writeSession();
}

function loadSettings() {
  const saved = readStore(SETTINGS_KEY, {});
  if (!saved || typeof saved !== "object") return;
  state.settings = {
    random: Boolean(saved.random),
    scope: SCOPES.includes(saved.scope) ? saved.scope : "all",
    autoNext: Boolean(saved.autoNext),
  };
}

async function readBuiltinFile(url, gzip) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!gzip) return response.json();
  if (typeof DecompressionStream !== "function" || !response.body) {
    throw new Error("浏览器不支持 gzip 流式解压");
  }
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
}

async function loadBuiltinBanks() {
  try {
    // 题库由 scripts/prepare-default-bank.mjs 预先生成。这里相对页面地址定位文件，
    // 站点部署在子路径（如 https://host/xxx/）时也能取到。
    const base = new URL("../builtin-data/2026-chemistry-banks", document.baseURI).href;
    let data = null;
    try {
      data = await readBuiltinFile(`${base}.json.gz?v=2`, true);
    } catch (error) {
      console.warn("[题库] 压缩包读取失败，退回纯文本", error);
    }
    if (!data) data = await readBuiltinFile(`${base}.json?v=2`, false);
    const list = Array.isArray(data?.banks) ? data.banks : [];
    return list
      .filter((bank) => bank && bank.id && Array.isArray(bank.questions) && bank.questions.length)
      .map((bank) => ({
        id: bank.id,
        name: bank.name || "2026年高考化学真题",
        source: "builtin",
        updatedAt: data.generatedAt || Date.now(),
        questions: bank.questions,
      }));
  } catch (error) {
    console.warn("[题库] 默认高考化学内置题库加载失败", error);
    showToast(`内置真题未加载：${error.message || "请重新运行 npm run dev 后刷新"}`);
    return [];
  }
}

async function refreshBanks() {
  const [banks, builtins] = await Promise.all([listBanks(), loadBuiltinBanks()]);
  const mergedBanks = [
    ...builtins,
    ...banks.filter((bank) => bank.source === "word" || bank.source === "pdf"),
  ];
  state.banks = mergedBanks
    .map((bank) => ({
      id: bank.id,
      name: bank.name || "未命名题库",
      source: bank.source,
      updatedAt: bank.updatedAt || Date.now(),
      // 内置真题与本地题库都叠加上本机校正过的字段
      questions: applyCorrections(toQuizQuestions(bank)),
    }))
    .filter((bank) => bank.questions.length);
}

function bankStats(bank) {
  let answered = 0;
  let correct = 0;
  let flagged = 0;
  let corrected = 0;
  bank.questions.forEach((question) => {
    if (question.corrected) corrected += 1;
    const response = state.responses.get(question.uid);
    if (!response) return;
    if (response.submitted) answered += 1;
    if (response.submitted && response.correct) correct += 1;
    if (response.flagged) flagged += 1;
  });
  return { answered, correct, flagged, corrected };
}

function inScope(question, scope) {
  const response = state.responses.get(question.uid);
  if (scope === "unanswered") return !response?.submitted;
  if (scope === "wrong") return Boolean(response?.submitted && !response.correct);
  if (scope === "flagged") return Boolean(response?.flagged);
  return true;
}

function selectedQuestions() {
  return state.banks
    .filter((bank) => state.selected.has(bank.id))
    .flatMap((bank) => bank.questions)
    .filter((question) => inScope(question, state.settings.scope));
}

function buildPool(bankIds, scope) {
  const list = state.banks
    .filter((bank) => bankIds.includes(bank.id))
    .flatMap((bank) => bank.questions)
    .filter((question) => inScope(question, scope));
  return state.settings.random ? shuffle(list) : list;
}

function renderSetup() {
  const visible = state.banks.filter(
    (bank) => state.bankFilter === "all" || bank.source === state.bankFilter,
  );
  const totalQuestions = state.banks.reduce((sum, bank) => sum + bank.questions.length, 0);
  const pool = selectedQuestions();

  ui.bankEmpty.hidden = state.banks.length > 0;
  ui.bankList.hidden = state.banks.length === 0;
  ui.statBanks.textContent = String(state.banks.length);
  ui.statQuestions.textContent = String(totalQuestions);
  ui.statSelected.textContent = String(pool.length);

  ui.bankList.innerHTML = visible
    .map((bank) => {
      const stats = bankStats(bank);
      const picked = state.selected.has(bank.id);
      const badge =
        bank.source === "word"
          ? { className: "word", label: "W" }
          : bank.source === "builtin"
            ? { className: "builtin", label: "内" }
            : { className: "pdf", label: "P" };
      return `<div class="bank-card${picked ? " picked" : ""}">
        <label class="bank-pick">
          <input type="checkbox" data-id="${escapeHtml(bank.id)}" ${picked ? "checked" : ""} />
          <span class="bank-badge ${badge.className}">${badge.label}</span>
          <span class="bank-copy">
            <strong>${escapeHtml(bank.name)}</strong>
            <small>${bank.questions.length} 题 · 已答 ${stats.answered} · 答对 ${stats.correct}${stats.flagged ? ` · 标记 ${stats.flagged}` : ""}${stats.corrected ? ` · 校正 ${stats.corrected}` : ""} · 更新于 ${escapeHtml(formatSavedAt(bank.updatedAt))}</small>
          </span>
        </label>
        <button class="bank-solo" type="button" data-id="${escapeHtml(bank.id)}">单独刷</button>
      </div>`;
    })
    .join("");

  ui.orderModes.querySelectorAll(".segment").forEach((button) => {
    const active = (button.dataset.order === "random") === state.settings.random;
    button.classList.toggle("active", active);
  });
  ui.scopeModes.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.scope === state.settings.scope);
  });
  ui.sourceChips.querySelectorAll(".chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.source === state.bankFilter);
  });
  ui.autoNext.checked = state.settings.autoNext;

  const pickedBanks = state.banks.filter((bank) => state.selected.has(bank.id));
  const wordCount = pickedBanks.filter((bank) => bank.source === "word").length;
  const pdfCount = pickedBanks.filter((bank) => bank.source === "pdf").length;
  const builtinCount = pickedBanks.filter((bank) => bank.source === "builtin").length;
  const pickedParts = [];
  if (builtinCount) pickedParts.push(`内置真题 ${builtinCount} 个`);
  if (wordCount) pickedParts.push(`Word ${wordCount} 个`);
  if (pdfCount) pickedParts.push(`PDF ${pdfCount} 个`);
  ui.pickSummary.textContent = pickedBanks.length
    ? `已选 ${pickedBanks.length} 个题库：${pickedParts.join(" · ")}`
    : "还没有选择题库";

  ui.startPractice.disabled = pool.length === 0;
  ui.startPractice.textContent = `开始刷题（${pool.length}）`;
}

function enterSetup() {
  ui.practiceView.hidden = true;
  ui.setupView.hidden = false;
  renderSetup();
}

function enterPractice() {
  ui.setupView.hidden = true;
  ui.practiceView.hidden = false;
  const bankCount = new Set(state.pool.map((question) => question.bankId)).size;
  ui.practiceTitle.textContent =
    bankCount === 1 ? state.pool[0].bankName : `混合练习 · ${bankCount} 个题库`;
  renderPractice();
}

function renderPractice() {
  const total = state.pool.length;
  const question = state.pool[state.index];
  if (!question) return;

  const response = responseFor(question);
  const answered = state.pool.filter((item) => responseFor(item).submitted).length;
  const correct = state.pool.filter((item) => {
    const itemResponse = responseFor(item);
    return itemResponse.submitted && itemResponse.correct;
  }).length;
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;

  ui.practiceProgress.textContent = `第 ${state.index + 1} / ${total} 题 · 已答 ${answered} 题 · 答对 ${correct} 题 · 正确率 ${answered ? `${accuracy}%` : "—"}`;
  ui.progressBar.style.width = `${total ? ((state.index + 1) / total) * 100 : 0}%`;

  ui.qNumber.textContent = `第 ${state.index + 1} 题`;
  const sourceLabel =
    question.source === "word" ? "Word 题库" : question.source === "builtin" ? "内置真题" : "PDF 题库";
  ui.qBank.textContent = `${question.bankName} · ${sourceLabel}`;
  ui.qType.textContent =
    question.type === "multiple" ? "多选题" : question.type === "judge" ? "判断题" : "单选题";
  ui.qCorrected.hidden = !question.corrected;
  ui.flagButton.classList.toggle("active", response.flagged);
  ui.flagButton.textContent = response.flagged ? "已标记" : "标记本题";
  ui.qTitle.innerHTML = renderFormulaContent(question.title, question.titleImages);

  ui.qImages.hidden = question.images.length === 0;
  ui.qImages.innerHTML = question.images
    .map(
      (image, index) =>
        `<figure class="q-image"><img src="${escapeHtml(image.src)}" alt="题目图片 ${index + 1}"></figure>`,
    )
    .join("");

  ui.prevButton.disabled = state.index === 0;
  ui.nextButton.disabled = state.index >= total - 1;
  ui.submitButton.hidden = response.submitted;

  renderOptions(question, response);
  renderFeedback(question, response);
  renderNav();

  const allAnswered = answered === total;
  ui.finishCard.hidden = !allAnswered;
  if (allAnswered) {
    ui.finishSummary.textContent = `共 ${total} 题 · 答对 ${correct} 题 · 正确率 ${accuracy}%`;
    ui.practiceWrongOnly.disabled = total - correct === 0;
  }
}

function renderOptions(question, response) {
  const submitted = response.submitted;
  const inputType = question.type === "multiple" ? "checkbox" : "radio";
  ui.qOptions.innerHTML = question.options
    .map((option) => {
      const selected = response.selected.includes(option.key);
      const isCorrect = question.answer.includes(option.key);
      const className = [
        "q-option",
        selected ? "selected" : "",
        submitted && isCorrect ? "is-correct" : "",
        submitted && selected && !isCorrect ? "is-wrong" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<label class="${className}">
        <input type="${inputType}" name="quiz-answer" value="${escapeHtml(option.key)}" ${selected ? "checked" : ""} ${submitted ? "disabled" : ""} />
        <span class="option-key">${escapeHtml(option.key)}</span>
        <span class="option-content">${renderFormulaContent(option.content, option.formulaImages)}</span>
        ${submitted && isCorrect ? '<span class="option-mark">正确答案</span>' : ""}
      </label>`;
    })
    .join("");

  ui.qOptions.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (question.type === "multiple") {
        const picked = new Set(response.selected);
        if (input.checked) picked.add(input.value);
        else picked.delete(input.value);
        response.selected = [...picked].sort();
      } else {
        response.selected = [input.value];
      }
      ui.qOptions.querySelectorAll(".q-option").forEach((option) => {
        option.classList.toggle("selected", option.querySelector("input").checked);
      });
      saveProgress();
    });
  });
}

function renderFeedback(question, response) {
  if (!response.submitted) {
    ui.qFeedback.hidden = true;
    ui.qFeedback.className = "q-feedback";
    ui.qFeedback.innerHTML = "";
    return;
  }
  const gallery = question.explanationImages
    .map(
      (image, index) =>
        `<img class="formula-image" src="${escapeHtml(image.src)}" alt="解析图片 ${index + 1}">`,
    )
    .join("");
  ui.qFeedback.hidden = false;
  ui.qFeedback.className = `q-feedback ${response.correct ? "correct" : "wrong"}`;
  ui.qFeedback.innerHTML = `
    <div class="feedback-heading">${response.correct ? "回答正确" : "再接再厉"}</div>
    <div class="feedback-answer">正确答案：<strong>${escapeHtml(question.answer.join("、"))}</strong></div>
    <div class="feedback-explanation">
      <strong>解析</strong>
      <p>${
        question.explanation
          ? renderFormulaContent(question.explanation, [], question.explanationImages.length ? "原文公式见下方图片" : "原文公式图片未能匹配")
          : "这道题没有提供解析。"
      }</p>
      ${gallery ? `<div class="formula-gallery">${gallery}</div>` : ""}
    </div>`;
}

function renderNav() {
  ui.navList.innerHTML = state.pool
    .map((question, index) => {
      const response = responseFor(question);
      const status = response.submitted ? (response.correct ? "correct" : "wrong") : "";
      return `<button class="nav-item ${index === state.index ? "active" : ""} ${status}" data-index="${index}" type="button">
        <span>${index + 1}</span>
        ${response.flagged ? '<i class="nav-flag">★</i>' : ""}
      </button>`;
    })
    .join("");

  ui.navList.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.index = Number(button.dataset.index);
      saveSession();
      renderPractice();
    });
  });
}

function goto(index) {
  const next = Math.min(Math.max(index, 0), state.pool.length - 1);
  if (next === state.index) return;
  state.index = next;
  saveSession();
  renderPractice();
}

function startPool(bankIds, scope) {
  const pool = buildPool(bankIds, scope);
  if (!pool.length) {
    showToast("当前范围内没有可练习的题目");
    return false;
  }
  state.selected = new Set(bankIds);
  state.pool = pool;
  state.poolBankIds = [...bankIds];
  state.index = 0;
  saveSession();
  enterPractice();
  return true;
}

function clearPoolResponses() {
  state.banks
    .filter((bank) => state.poolBankIds.includes(bank.id))
    .forEach((bank) => bank.questions.forEach((question) => state.responses.delete(question.uid)));
  writeProgress();
}

function rebuildPool() {
  const pool = buildPool(state.poolBankIds, state.settings.scope);
  return pool.length ? pool : buildPool(state.poolBankIds, "all");
}

function restartPractice() {
  if (!window.confirm("重新练习会清空本轮所选题库的答题记录，确定继续吗？")) return;
  clearPoolResponses();
  state.pool = rebuildPool();
  if (!state.pool.length) {
    enterSetup();
    showToast("题库中没有可练习的题目");
    return;
  }
  state.index = 0;
  saveSession();
  renderPractice();
  showToast("已清空答题记录，重新开始");
}

/* ---------------- 题目校正 ---------------- */

const OPTION_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const JUDGE_KEYS = ["正确", "错误"];

function correctOptionRows(options, answer) {
  return options
    .map(
      (option) => `<div class="correct-option">
        <input type="text" class="correct-option-key" value="${escapeHtml(option.key)}" aria-label="选项标号" />
        <input type="text" class="correct-option-content" value="${escapeHtml(option.content)}" aria-label="选项内容" />
        <label class="correct-option-right"><input type="checkbox" class="correct-option-answer" ${answer.includes(option.key) ? "checked" : ""} />正确</label>
        <button class="correct-remove" type="button">删除</button>
      </div>`,
    )
    .join("");
}

function openCorrector() {
  const question = state.pool[state.index];
  if (!question) return;
  state.correcting = question;
  ui.correctHeading.textContent = `校正本题 · ${question.bankName}`;
  ui.correctType.value = question.type;
  ui.correctTitle.value = question.title;
  ui.correctExplanation.value = question.explanation;
  ui.correctOptions.innerHTML = correctOptionRows(question.options, question.answer);
  ui.correctView.hidden = false;
  ui.correctTitle.focus();
}

function closeCorrector() {
  state.correcting = null;
  ui.correctView.hidden = true;
}

function readCorrectorForm() {
  const rows = [...ui.correctOptions.querySelectorAll(".correct-option")];
  const options = [];
  const answer = [];
  rows.forEach((row) => {
    const key = row.querySelector(".correct-option-key").value.trim();
    const content = row.querySelector(".correct-option-content").value.trim();
    if (!key && !content) return;
    const finalKey = key || OPTION_KEYS[options.length] || `选项${options.length + 1}`;
    options.push({ key: finalKey, content });
    if (row.querySelector(".correct-option-answer").checked) answer.push(finalKey);
  });
  return {
    type: ui.correctType.value,
    title: ui.correctTitle.value.trim(),
    explanation: ui.correctExplanation.value.trim(),
    options,
    answer: [...new Set(answer)],
  };
}

function saveCorrector() {
  const question = state.correcting;
  if (!question) return;
  const form = readCorrectorForm();
  if (!form.title) {
    showToast("题干不能为空");
    return;
  }
  if (form.options.length < 2) {
    showToast("至少保留两个选项");
    return;
  }
  if (!form.answer.length) {
    showToast("请勾选正确答案");
    return;
  }

  const record = getCorrection(question.uid);
  const original =
    record?.original ||
    {
      type: question.type,
      title: question.title,
      options: question.options,
      answer: question.answer,
      explanation: question.explanation,
    };

  // 选项里可能带公式图片，按选项标号保留下来
  const images = new Map(question.options.map((option) => [option.key, option.formulaImages || []]));
  saveCorrection(question.uid, form, original);
  question.type = form.type;
  question.title = form.title;
  question.options = form.options.map((option) => ({ ...option, formulaImages: images.get(option.key) || [] }));
  question.answer = form.answer;
  question.explanation = form.explanation;
  question.corrected = true;

  // 已提交的题目按新答案重新判分
  const response = state.responses.get(question.uid);
  if (response?.submitted) {
    response.correct = sameAnswer(response.selected, question.answer);
  }
  saveProgress();
  closeCorrector();
  renderPractice();
  showToast("已保存校正，本题按校正后的内容判分");
}

function resetCorrector() {
  const question = state.correcting;
  if (!question) return;
  const record = getCorrection(question.uid);
  if (!record?.original) {
    showToast("这道题还没有校正记录");
    return;
  }
  const source = record.original;
  question.type = source.type || question.type;
  question.title = source.title ?? question.title;
  question.options = source.options || question.options;
  question.answer = source.answer || question.answer;
  question.explanation = source.explanation ?? question.explanation;
  question.corrected = false;
  clearCorrection(question.uid);
  const response = state.responses.get(question.uid);
  if (response?.submitted) {
    response.correct = sameAnswer(response.selected, question.answer);
  }
  saveProgress();
  closeCorrector();
  renderPractice();
  showToast("已恢复原题");
}

function submitCurrent() {
  const question = state.pool[state.index];
  const response = responseFor(question);
  if (!response || !response.selected.length) {
    showToast("请先选择答案");
    return;
  }
  response.submitted = true;
  response.correct = sameAnswer(response.selected, question.answer);
  saveProgress();
  if (state.settings.autoNext && state.index < state.pool.length - 1) {
    state.index += 1;
  }
  saveSession();
  renderPractice();
}

async function resumeSession() {
  const session = readStore(SESSION_KEY, null);
  if (!session || !Array.isArray(session.order) || !session.order.length) return false;

  const byUid = new Map();
  state.banks.forEach((bank) => bank.questions.forEach((question) => byUid.set(question.uid, question)));
  const pool = session.order.map((uid) => byUid.get(uid)).filter(Boolean);
  if (!pool.length) return false;

  const bankIds = Array.isArray(session.bankIds) ? session.bankIds.filter(Boolean) : [];
  state.pool = pool;
  state.poolBankIds = bankIds.length ? bankIds : [...new Set(pool.map((question) => question.bankId))];
  state.selected = new Set(state.poolBankIds.filter((id) => state.banks.some((bank) => bank.id === id)));
  state.settings.random = Boolean(session.random);
  state.settings.scope = SCOPES.includes(session.scope) ? session.scope : "all";
  state.index = Math.min(Math.max(Number(session.index) || 0, 0), pool.length - 1);
  return true;
}

ui.sourceChips.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  state.bankFilter = chip.dataset.source;
  renderSetup();
});

ui.bankList.addEventListener("change", (event) => {
  const input = event.target.closest("input[type=checkbox]");
  if (!input) return;
  if (input.checked) state.selected.add(input.dataset.id);
  else state.selected.delete(input.dataset.id);
  renderSetup();
});

ui.bankList.addEventListener("click", (event) => {
  const button = event.target.closest(".bank-solo");
  if (!button) return;
  startPool([button.dataset.id], state.settings.scope);
});

ui.selectAll.addEventListener("click", () => {
  state.banks
    .filter((bank) => state.bankFilter === "all" || bank.source === state.bankFilter)
    .forEach((bank) => state.selected.add(bank.id));
  renderSetup();
});

ui.selectNone.addEventListener("click", () => {
  state.banks
    .filter((bank) => state.bankFilter === "all" || bank.source === state.bankFilter)
    .forEach((bank) => state.selected.delete(bank.id));
  renderSetup();
});

ui.orderModes.addEventListener("click", (event) => {
  const button = event.target.closest(".segment");
  if (!button) return;
  state.settings.random = button.dataset.order === "random";
  writeStore(SETTINGS_KEY, state.settings);
  renderSetup();
});

ui.scopeModes.addEventListener("click", (event) => {
  const button = event.target.closest(".segment");
  if (!button) return;
  state.settings.scope = button.dataset.scope;
  writeStore(SETTINGS_KEY, state.settings);
  renderSetup();
});

ui.autoNext.addEventListener("change", () => {
  state.settings.autoNext = ui.autoNext.checked;
  writeStore(SETTINGS_KEY, state.settings);
});

ui.startPractice.addEventListener("click", () => {
  startPool([...state.selected], state.settings.scope);
});

ui.prevButton.addEventListener("click", () => goto(state.index - 1));
ui.nextButton.addEventListener("click", () => goto(state.index + 1));
ui.submitButton.addEventListener("click", submitCurrent);

ui.flagButton.addEventListener("click", () => {
  const question = state.pool[state.index];
  if (!question) return;
  const response = responseFor(question);
  response.flagged = !response.flagged;
  saveProgress();
  renderPractice();
  showToast(response.flagged ? "已标记本题，可在选题页按标记筛选" : "已取消标记");
});

ui.correctButton.addEventListener("click", openCorrector);
ui.correctClose.addEventListener("click", closeCorrector);
ui.correctCancel.addEventListener("click", closeCorrector);
ui.correctSave.addEventListener("click", saveCorrector);
ui.correctReset.addEventListener("click", resetCorrector);

ui.correctAddOption.addEventListener("click", () => {
  const index = ui.correctOptions.querySelectorAll(".correct-option").length;
  const row = document.createElement("div");
  row.className = "correct-option";
  row.innerHTML = `<input type="text" class="correct-option-key" value="${escapeHtml(
    OPTION_KEYS[index] || `选项${index + 1}`,
  )}" aria-label="选项标号" />
    <input type="text" class="correct-option-content" value="" aria-label="选项内容" />
    <label class="correct-option-right"><input type="checkbox" class="correct-option-answer" />正确</label>
    <button class="correct-remove" type="button">删除</button>`;
  ui.correctOptions.appendChild(row);
});

ui.correctOptions.addEventListener("click", (event) => {
  const button = event.target.closest(".correct-remove");
  if (!button) return;
  button.closest(".correct-option")?.remove();
});

ui.correctType.addEventListener("change", () => {
  if (ui.correctType.value !== "judge") return;
  const checked = [...ui.correctOptions.querySelectorAll(".correct-option-answer")].findIndex((input) => input.checked);
  ui.correctOptions.innerHTML = correctOptionRows(
    JUDGE_KEYS.map((key) => ({ key, content: key })),
    checked === 0 ? ["正确"] : checked === 1 ? ["错误"] : [],
  );
});

ui.practiceExit.addEventListener("click", () => {
  flushRecords();
  enterSetup();
});

window.addEventListener("pagehide", flushRecords);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushRecords();
});

ui.practiceRestart.addEventListener("click", restartPractice);

ui.practiceAgain.addEventListener("click", () => {
  clearPoolResponses();
  state.pool = rebuildPool();
  if (!state.pool.length) {
    enterSetup();
    showToast("题库中没有可练习的题目");
    return;
  }
  state.index = 0;
  saveSession();
  renderPractice();
  showToast("已开始新的一轮练习");
});

ui.practiceWrongOnly.addEventListener("click", () => {
  const wrongUids = state.pool
    .filter((question) => {
      const response = state.responses.get(question.uid);
      return response?.submitted && !response.correct;
    })
    .map((question) => question.uid);
  if (!wrongUids.length) {
    showToast("本轮全部答对，没有错题");
    return;
  }
  state.settings.scope = "wrong";
  writeStore(SETTINGS_KEY, state.settings);
  if (startPool(state.poolBankIds, "wrong")) showToast(`已开始练习 ${state.pool.length} 道错题`);
});

document.addEventListener("keydown", (event) => {
  if (!ui.correctView.hidden) {
    // 校正面板打开时不再响应刷题快捷键，Esc 关闭面板
    if (event.key === "Escape") closeCorrector();
    return;
  }
  if (ui.practiceView.hidden) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const question = state.pool[state.index];
  if (!question) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goto(state.index - 1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    goto(state.index + 1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const response = responseFor(question);
    if (response.submitted) goto(state.index + 1);
    else submitCurrent();
    return;
  }
  if (event.key === "f" || event.key === "F") {
    event.preventDefault();
    ui.flagButton.click();
    return;
  }
  if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    openCorrector();
    return;
  }
  const digit = Number(event.key);
  if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
    const response = responseFor(question);
    if (response.submitted) return;
    const input = ui.qOptions.querySelectorAll("input")[digit - 1];
    if (!input) return;
    event.preventDefault();
    input.checked = question.type === "multiple" ? !input.checked : true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

async function init() {
  loadSettings();
  loadProgress();
  await refreshBanks();
  const resumed = await resumeSession();
  if (resumed) {
    // 恢复的是上一次的练习池（可能只有某一套卷），默认真题仍然全部预选，
    // 点“返回选题”就能直接刷全部试卷
    const builtinIds = state.banks.filter((bank) => bank.source === "builtin").map((bank) => bank.id);
    builtinIds.forEach((id) => state.selected.add(id));
    const builtinCount = state.banks
      .filter((bank) => bank.source === "builtin")
      .reduce((sum, bank) => sum + bank.questions.length, 0);
    if (builtinCount) {
      showToast(`已恢复上次练习（${state.pool.length} 题）· 返回选题可刷全部 ${builtinCount} 道默认真题`);
    }
    enterPractice();
  } else {
    if (!state.selectionReady && !state.selected.size) {
      state.banks.forEach((bank) => state.selected.add(bank.id));
    }
    state.selectionReady = true;
    enterSetup();
  }
}

ensurePersistence();
init();
