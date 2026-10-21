import "./styles.css";
import { formatSavedAt } from "../../src/question-bank.js";
import { escapeHtml, renderFormulaContent } from "../../src/question-text.js";
import { sameAnswer, shuffle, toQuizQuestions } from "../../src/quiz-model.js";
import {
  applyCorrections,
  clearCorrection,
  countCorrectionsFor,
  getCorrection,
  saveCorrection,
} from "../../src/question-correction.js";
import { correctionApi } from "../../src/api.js";
import { getSession, isTeacher } from "../../src/auth.js";
import { initAccountUI } from "./account-ui.js";
import { initFeedbackUI } from "./feedback-ui.js";
import { initImageLightbox } from "./image-lightbox.js";

document.documentElement.classList.toggle("embedded", new URLSearchParams(location.search).has("embedded"));

const SESSION_KEY = "exam-workspace:quiz:session";
const PROGRESS_KEY = "exam-workspace:quiz:progress";
const SETTINGS_KEY = "exam-workspace:quiz:settings";
const SCOPES = ["all", "unanswered", "wrong", "flagged"];
const QTYPE_MODES = ["all", "objective", "subjective"];
const TYPE_LABELS = { single: "单选题", multiple: "多选题", judge: "判断题", subjective: "主观题" };

const byId = (id) => document.getElementById(id);
const ui = {
  setupView: byId("setupView"),
  practiceView: byId("practiceView"),
  statBanks: byId("statBanks"),
  statQuestions: byId("statQuestions"),
  statSelected: byId("statSelected"),
  bankList: byId("bankList"),
  bankEmpty: byId("bankEmpty"),
  selectAll: byId("selectAll"),
  selectNone: byId("selectNone"),
  orderModes: byId("orderModes"),
  scopeModes: byId("scopeModes"),
  typeModes: byId("typeModes"),
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
  feedbackButton: byId("feedbackButton"),
  correctButton: byId("correctButton"),
  correctView: byId("correctView"),
  correctPdfSources: byId("correctPdfSources"),
  authModal: byId("authView"),
  feedbackModal: byId("feedbackView"),
  inboxModal: byId("inboxView"),
  lightbox: byId("imageLightbox"),
  correctHeading: byId("correctHeading"),
  correctClose: byId("correctClose"),
  correctType: byId("correctType"),
  correctTitle: byId("correctTitle"),
  correctAnswerField: byId("correctAnswerField"),
  correctAnswerText: byId("correctAnswerText"),
  correctOptionsField: byId("correctOptionsField"),
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
  settings: { random: false, scope: "all", qtype: "all", autoNext: false },
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

function emptyResponse() {
  return {
    selected: [],
    // 主观题：作答文本 + 自评流程（提交 → 查看参考答案 → 我已掌握 / 需要复习）
    text: "",
    staged: false,
    revealed: false,
    rated: false,
    submitted: false,
    correct: false,
    flagged: false,
  };
}

function responseFor(question) {
  if (!state.responses.has(question.uid)) {
    state.responses.set(question.uid, emptyResponse());
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
        ...emptyResponse(),
        selected: Array.isArray(value.selected) ? value.selected.map(String) : [],
        text: typeof value.text === "string" ? value.text : "",
        staged: Boolean(value.staged),
        revealed: Boolean(value.revealed),
        rated: Boolean(value.rated),
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
    const empty =
      !value.submitted &&
      !value.flagged &&
      !value.selected.length &&
      !value.text &&
      !value.staged &&
      !value.rated;
    if (empty) return;
    const splitAt = uid.indexOf("::");
    if (splitAt < 0) return;
    const bankId = uid.slice(0, splitAt);
    const questionId = uid.slice(splitAt + 2);
    if (!grouped[bankId]) grouped[bankId] = {};
    grouped[bankId][questionId] = {
      selected: value.selected,
      text: value.text,
      staged: value.staged,
      revealed: value.revealed,
      rated: value.rated,
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
    qtype: state.settings.qtype,
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
    qtype: QTYPE_MODES.includes(saved.qtype) ? saved.qtype : "all",
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

// 内置真题题量大（含主观题），按卷拆分成多个文件：选题页只读索引，
// 开始刷题时才下载被选中的卷，避免首屏一次性拉取几十 MB。
function builtinUrl(path) {
  // BASE_URL 在开发时是 "/"，独立发布时是 "./"，这样部署在子路径（如 GitHub Pages）也能取到。
  return new URL(`${import.meta.env.BASE_URL}builtin-data/${path}`, document.baseURI).href;
}

async function loadBuiltinIndex() {
  try {
    const data = await readBuiltinFile(builtinUrl("index.json?v=3"), false);
    const generatedAt = data?.generatedAt || Date.now();
    const list = Array.isArray(data?.banks) ? data.banks : [];
    return list
      .filter((bank) => bank && bank.id && bank.file && Number(bank.questionCount) > 0)
      .map((bank) => ({
        id: bank.id,
        name: bank.name || "2026年高考化学真题",
        source: "builtin",
        updatedAt: generatedAt,
        questionCount: Number(bank.questionCount),
        typeStat: bank.typeStat || {},
        file: bank.file,
        questions: [],
      }));
  } catch (error) {
    console.warn("[题库] 默认高考化学内置题库加载失败", error);
    showToast(`内置真题未加载：${error.message || "请重新运行 npm run dev 后刷新"}`);
    return [];
  }
}

async function loadBankQuestions(bank) {
  const file = bank.file;
  let data = null;
  try {
    data = await readBuiltinFile(builtinUrl(`${file}.gz?v=3`), true);
  } catch (error) {
    console.warn("[题库] 分卷压缩包读取失败，退回纯文本", bank.id, error);
  }
  if (!data) data = await readBuiltinFile(builtinUrl(`${file}?v=3`), false);
  const list = Array.isArray(data?.questions) ? data.questions : [];
  bank.questions = applyCorrections(
    toQuizQuestions({ id: bank.id, name: bank.name, source: "builtin", questions: list }),
  );
  // 教师校对过的内容以服务端为准，覆盖本机校正并对所有人生效
  await applyServerCorrections(bank);
  bank.questionCount = bank.questions.length;
  bank.typeStat = bank.questions.reduce((stat, question) => {
    stat[question.type] = (stat[question.type] || 0) + 1;
    return stat;
  }, {});
  delete bank.file;
}

/** 拉取服务端校对结果并覆盖到题目上（未登录也能读到，接口本身不校验身份） */
async function applyServerCorrections(bank) {
  try {
    const data = await correctionApi.list(bank.id);
    const list = Array.isArray(data?.corrections) ? data.corrections : [];
    if (!list.length) return;
    const map = new Map(list.map((item) => [`${item.bankId}::${item.questionId}`, item]));
    bank.questions = bank.questions.map((question) => {
      const patch = map.get(question.uid);
      if (!patch) return question;
      const subjective = patch.type === "subjective";
      return {
        ...question,
        type: patch.type || question.type,
        title: patch.title || question.title,
        options: subjective
          ? []
          : Array.isArray(patch.options) && patch.options.length
            ? patch.options
            : question.options,
        answer: subjective
          ? []
          : Array.isArray(patch.answer) && patch.answer.length
            ? patch.answer
            : question.answer,
        answerText: typeof patch.answerText === "string" ? patch.answerText : "",
        explanation: patch.explanation ?? question.explanation,
        corrected: true,
      };
    });
  } catch (error) {
    console.warn("[题库] 服务端校正加载失败", bank.id, error);
  }
}

async function ensureQuestions(bankIds) {
  const pending = state.banks.filter((bank) => bankIds.includes(bank.id) && bank.file);
  if (!pending.length) return;
  showToast(`正在加载 ${pending.length} 份题库…`);
  await Promise.all(
    pending.map(async (bank) => {
      try {
        await loadBankQuestions(bank);
      } catch (error) {
        console.warn("[题库] 分卷加载失败", bank.id, error);
        showToast(`${bank.name} 加载失败：${error.message || "请刷新重试"}`);
        bank.file = undefined;
        bank.questionCount = 0;
        bank.questions = [];
      }
    }),
  );
}

async function refreshBanks() {
  // 只使用内置真题题库，不再合并 Word / PDF 导入的本地题库
  const builtins = await loadBuiltinIndex();
  state.banks = builtins
    .map((bank) => {
      // 内置真题先只带索引（questions 为空），开始刷题时再按需下载
      const questions = Array.isArray(bank.questions) && bank.questions.length
        ? applyCorrections(toQuizQuestions(bank))
        : [];
      return {
        id: bank.id,
        name: bank.name || "未命名题库",
        source: bank.source,
        updatedAt: bank.updatedAt || Date.now(),
        file: bank.file,
        questionCount: questions.length || Number(bank.questionCount) || 0,
        typeStat: questions.length
          ? questions.reduce((stat, question) => {
              stat[question.type] = (stat[question.type] || 0) + 1;
              return stat;
            }, {})
          : bank.typeStat || {},
        questions,
      };
    })
    .filter((bank) => bank.questionCount > 0);
}

/** 题库未加载题目时也能统计：答题记录与校正记录都按 bankId::questionId 存 */
function bankStats(bank) {
  const prefix = `${bank.id}::`;
  let answered = 0;
  let correct = 0;
  let flagged = 0;
  state.responses.forEach((response, uid) => {
    if (!uid.startsWith(prefix)) return;
    if (response.submitted) answered += 1;
    if (response.submitted && response.correct) correct += 1;
    if (response.flagged) flagged += 1;
  });
  return { answered, correct, flagged, corrected: countCorrectionsFor(bank.id) };
}

function inScope(question, scope) {
  const response = state.responses.get(question.uid);
  if (scope === "unanswered") return !response?.submitted;
  if (scope === "wrong") return Boolean(response?.submitted && !response.correct);
  if (scope === "flagged") return Boolean(response?.flagged);
  return true;
}

function inType(question, qtype) {
  if (qtype === "subjective") return question.type === "subjective";
  if (qtype === "objective") return question.type !== "subjective";
  return true;
}

function buildPool(bankIds, scope, qtype) {
  const list = state.banks
    .filter((bank) => bankIds.includes(bank.id))
    .flatMap((bank) => bank.questions)
    .filter((question) => inScope(question, scope) && inType(question, qtype));
  return state.settings.random ? shuffle(list) : list;
}

function questionCountOf(bank) {
  return bank.questions.length || Number(bank.questionCount) || 0;
}

function typeCountOf(bank, qtype) {
  const stat = bank.typeStat || {};
  if (qtype === "subjective") return Number(stat.subjective || 0);
  if (qtype === "objective") {
    return Number(stat.single || 0) + Number(stat.multiple || 0) + Number(stat.judge || 0);
  }
  return questionCountOf(bank);
}

/** 题库未加载时按范围估算可练题数，用于选题页的“本次选中” */
function estimateCount(bank, scope, qtype) {
  const byType = typeCountOf(bank, qtype);
  if (scope === "all") return byType;
  const prefix = `${bank.id}::`;
  let answered = 0;
  let wrong = 0;
  let flagged = 0;
  state.responses.forEach((response, uid) => {
    if (!uid.startsWith(prefix)) return;
    if (response.submitted) answered += 1;
    if (response.submitted && !response.correct) wrong += 1;
    if (response.flagged) flagged += 1;
  });
  if (scope === "wrong") return Math.min(byType, wrong);
  if (scope === "flagged") return Math.min(byType, flagged);
  return Math.min(byType, Math.max(questionCountOf(bank) - answered, 0));
}

function selectedCount() {
  const { scope, qtype } = state.settings;
  return state.banks
    .filter((bank) => state.selected.has(bank.id))
    .reduce((sum, bank) => sum + estimateCount(bank, scope, qtype), 0);
}

function renderSetup() {
  const totalQuestions = state.banks.reduce((sum, bank) => sum + questionCountOf(bank), 0);
  const pool = selectedCount();

  ui.bankEmpty.hidden = state.banks.length > 0;
  ui.bankList.hidden = state.banks.length === 0;
  ui.statBanks.textContent = String(state.banks.length);
  ui.statQuestions.textContent = String(totalQuestions);
  ui.statSelected.textContent = String(pool);

  ui.bankList.innerHTML = state.banks
    .map((bank) => {
      const stats = bankStats(bank);
      const picked = state.selected.has(bank.id);
      const stat = bank.typeStat || {};
      const subjective = Number(stat.subjective || 0);
      return `<div class="bank-card${picked ? " picked" : ""}">
        <label class="bank-pick">
          <input type="checkbox" data-id="${escapeHtml(bank.id)}" ${picked ? "checked" : ""} />
          <span class="bank-badge builtin">内</span>
          <span class="bank-copy">
            <strong>${escapeHtml(bank.name)}</strong>
            <small>${questionCountOf(bank)} 题${subjective ? ` · 主观 ${subjective}` : ""} · 已答 ${stats.answered} · 答对 ${stats.correct}${stats.flagged ? ` · 标记 ${stats.flagged}` : ""}${stats.corrected ? ` · 校正 ${stats.corrected}` : ""} · 更新于 ${escapeHtml(formatSavedAt(bank.updatedAt))}</small>
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
  ui.typeModes.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.qtype === state.settings.qtype);
  });
  ui.autoNext.checked = state.settings.autoNext;

  const pickedBanks = state.banks.filter((bank) => state.selected.has(bank.id));
  ui.pickSummary.textContent = pickedBanks.length
    ? `已选 ${pickedBanks.length} 个题库：内置真题 ${pickedBanks.length} 个`
    : "还没有选择题库";

  // 题库未加载时“本次选中”是估算值，只有没选择题库才真正禁用
  ui.startPractice.disabled = pool === 0 && state.selected.size === 0;
  ui.startPractice.textContent = `开始刷题（${pool}）`;
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
  ui.qBank.textContent = `${question.bankName} · 内置真题`;
  ui.qType.textContent = TYPE_LABELS[question.type] || "单选题";
  ui.qCorrected.hidden = !question.corrected;
  // 校对题库是教师权限；学生只能走“反馈本题”
  ui.correctButton.hidden = !isTeacher();
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
  // 主观题提交后还要自评，staged 阶段也不需要再点“提交答案”
  ui.submitButton.hidden = response.submitted || (question.type === "subjective" && response.staged);
  ui.submitButton.textContent = question.type === "subjective" ? "提交作答" : "提交答案";

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

/** 主观题：文本作答，不自动判分，提交后对照参考答案自评 */
function renderSubjectiveInput(question, response) {
  const locked = response.submitted;
  ui.qOptions.className = "q-options subjective";
  ui.qOptions.innerHTML = `<div class="q-subjective">
      <label class="subjective-label" for="subjectiveInput">你的作答</label>
      <textarea id="subjectiveInput" class="subjective-input" rows="7" ${locked ? "disabled" : ""}
        placeholder="先写出你的作答，提交后可以对照参考答案自评。">${escapeHtml(response.text || "")}</textarea>
      <p class="subjective-hint">主观题不自动判分：提交后可查看参考答案，再选择“我已掌握”或“需要复习”。</p>
    </div>`;
  const input = ui.qOptions.querySelector("#subjectiveInput");
  if (!input) return;
  input.addEventListener("input", () => {
    response.text = input.value;
    saveProgress();
  });
}

function renderOptions(question, response) {
  if (question.type === "subjective") {
    renderSubjectiveInput(question, response);
    return;
  }
  ui.qOptions.className = "q-options";
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

function feedbackGallery(question) {
  return question.explanationImages
    .map(
      (image, index) =>
        `<img class="formula-image" src="${escapeHtml(image.src)}" alt="解析图片 ${index + 1}">`,
    )
    .join("");
}

function feedbackExplanation(question) {
  return `<div class="feedback-explanation">
      <strong>解析</strong>
      <p>${
        question.explanation
          ? renderFormulaContent(question.explanation, [], question.explanationImages.length ? "原文公式见下方图片" : "原文公式图片未能匹配")
          : "这道题没有提供解析。"
      }</p>
      ${feedbackGallery(question) ? `<div class="formula-gallery">${feedbackGallery(question)}</div>` : ""}
    </div>`;
}

function renderSubjectiveFeedback(question, response) {
  if (!response.staged && !response.submitted) {
    ui.qFeedback.hidden = true;
    ui.qFeedback.className = "q-feedback";
    ui.qFeedback.innerHTML = "";
    return;
  }
  const rated = Boolean(response.rated);
  const revealed = rated || Boolean(response.revealed);
  const mine = (response.text || "").trim();
  const reference = question.answerText
    ? renderFormulaContent(question.answerText, [], "")
    : "这道题没有提供参考答案。";

  ui.qFeedback.hidden = false;
  ui.qFeedback.className = `q-feedback ${rated ? (response.correct ? "correct" : "wrong") : "pending"}`;
  ui.qFeedback.innerHTML = `
    <div class="feedback-heading">${
      rated ? (response.correct ? "自评结果：我已掌握" : "自评结果：需要复习") : "已提交作答，对照参考答案自评"
    }</div>
    <div class="feedback-block">
      <strong>你的作答</strong>
      <p>${mine ? escapeHtml(mine) : '<span class="feedback-empty">（未填写作答）</span>'}</p>
    </div>
    ${
      revealed
        ? `<div class="feedback-block">
      <strong>参考答案</strong>
      <p>${reference}</p>
    </div>`
        : ""
    }
    ${feedbackExplanation(question)}
    ${
      rated
        ? ""
        : revealed
          ? `<div class="feedback-actions">
      <button class="button button-primary" type="button" data-rate="true">我已掌握</button>
      <button class="button button-quiet" type="button" data-rate="false">需要复习</button>
    </div>`
          : `<div class="feedback-actions">
      <button class="button button-primary" type="button" data-reveal="true">查看参考答案并自评</button>
    </div>`
    }`;

  ui.qFeedback.querySelectorAll("[data-rate]").forEach((button) => {
    button.addEventListener("click", () => rateSubjective(button.dataset.rate === "true"));
  });
  ui.qFeedback.querySelectorAll("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      response.revealed = true;
      saveProgress();
      renderPractice();
    });
  });
}

function rateSubjective(mastered) {
  const question = state.pool[state.index];
  if (!question) return;
  const response = responseFor(question);
  response.revealed = true;
  response.rated = true;
  response.submitted = true;
  response.correct = mastered;
  // 与小程序一致：自评结果用一个中文标签保存，便于回看
  response.selected = [mastered ? "掌握" : "需复习"];
  saveProgress();
  if (state.settings.autoNext && state.index < state.pool.length - 1) state.index += 1;
  saveSession();
  renderPractice();
}

function renderFeedback(question, response) {
  if (question.type === "subjective") {
    renderSubjectiveFeedback(question, response);
    return;
  }
  if (!response.submitted) {
    ui.qFeedback.hidden = true;
    ui.qFeedback.className = "q-feedback";
    ui.qFeedback.innerHTML = "";
    return;
  }
  ui.qFeedback.hidden = false;
  ui.qFeedback.className = `q-feedback ${response.correct ? "correct" : "wrong"}`;
  ui.qFeedback.innerHTML = `
    <div class="feedback-heading">${response.correct ? "回答正确" : "再接再厉"}</div>
    <div class="feedback-answer">正确答案：<strong>${escapeHtml(question.answer.join("、"))}</strong></div>
    ${feedbackExplanation(question)}`;
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

/** 教师采纳反馈后定位到对应题目并直接打开校对面板 */
async function locateQuestion(bankId, questionId) {
  const ok = await startPool([bankId], "all", "all");
  if (!ok) return false;
  const uid = `${bankId}::${questionId}`;
  const index = state.pool.findIndex((question) => question.uid === uid);
  if (index < 0) {
    showToast("没有找到这条反馈对应的题目");
    return false;
  }
  state.index = index;
  saveSession();
  renderPractice();
  openCorrector();
  return true;
}

async function startPool(bankIds, scope, qtype) {
  // 内置真题在这里才真正下载被选中的卷
  await ensureQuestions(bankIds);
  const pool = buildPool(bankIds, scope, qtype);
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
  const prefixes = state.poolBankIds.map((id) => `${id}::`);
  [...state.responses.keys()].forEach((uid) => {
    if (prefixes.some((prefix) => uid.startsWith(prefix))) state.responses.delete(uid);
  });
  writeProgress();
}

function rebuildPool() {
  const { scope, qtype } = state.settings;
  const pool = buildPool(state.poolBankIds, scope, qtype);
  return pool.length ? pool : buildPool(state.poolBankIds, "all", "all");
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

function syncCorrectorFields(type) {
  const subjective = type === "subjective";
  ui.correctAnswerField.hidden = !subjective;
  ui.correctOptionsField.hidden = subjective;
}

function openCorrector() {
  const question = state.pool[state.index];
  if (!question) return;
  if (!isTeacher()) {
    showToast(getSession() ? "只有教师可以校对题目" : "请使用教师账号登录后再校对题目");
    account?.openLogin();
    return;
  }
  state.correcting = question;
  ui.correctHeading.textContent = `校正本题 · ${question.bankName}`;
  ui.correctType.value = question.type;
  ui.correctTitle.value = question.title;
  ui.correctAnswerText.value = question.answerText || "";
  ui.correctExplanation.value = question.explanation;
  ui.correctOptions.innerHTML = correctOptionRows(question.options, question.answer);
  syncCorrectorFields(question.type);
  ui.correctView.hidden = false;
  loadPdfPreview(question);
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
    answerText: ui.correctAnswerText.value.trim(),
    explanation: ui.correctExplanation.value.trim(),
    options,
    answer: [...new Set(answer)],
  };
}

async function saveCorrector() {
  const question = state.correcting;
  if (!question) return;
  if (!isTeacher()) {
    showToast(getSession() ? "只有教师可以校对题目" : "请使用教师账号登录后再校对题目");
    account?.openLogin();
    return;
  }
  const form = readCorrectorForm();
  if (!form.title) {
    showToast("题干不能为空");
    return;
  }
  if (form.type === "subjective") {
    if (!form.answerText) {
      showToast("请填写参考答案");
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

  const record = getCorrection(question.uid);
  const original =
    record?.original ||
    {
      type: question.type,
      title: question.title,
      options: question.options,
      answer: question.answer,
      answerText: question.answerText || "",
      explanation: question.explanation,
    };

  // 选项里可能带公式图片，按选项标号保留下来
  const images = new Map(question.options.map((option) => [option.key, option.formulaImages || []]));
  saveCorrection(question.uid, form, original);
  question.type = form.type;
  question.title = form.title;
  question.options = form.type === "subjective"
    ? []
    : form.options.map((option) => ({ ...option, formulaImages: images.get(option.key) || [] }));
  question.answer = form.type === "subjective" ? [] : form.answer;
  question.answerText = form.type === "subjective" ? form.answerText : "";
  question.explanation = form.explanation;
  question.corrected = true;

  // 已提交的客观题按新答案重新判分（主观题是自评结果，不重新判定）
  const response = state.responses.get(question.uid);
  if (response?.submitted && question.type !== "subjective") {
    response.correct = sameAnswer(response.selected, question.answer);
  }
  saveProgress();
  closeCorrector();
  renderPractice();

  // 教师校对结果写回后端题库，其他用户刷新后就能拿到同一份内容
  try {
    await correctionApi.save({
      bankId: question.bankId,
      questionId: question.id,
      type: question.type,
      title: question.title,
      options: question.options,
      answer: question.answer,
      answerText: question.answerText || "",
      explanation: question.explanation,
    });
    showToast("已保存校正，后端题库已同步更新");
  } catch (error) {
    showToast(`已保存到本机，同步后端失败：${error.message}`);
  }
}

async function resetCorrector() {
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
  question.answerText = typeof source.answerText === "string" ? source.answerText : question.answerText;
  question.explanation = source.explanation ?? question.explanation;
  question.corrected = false;
  clearCorrection(question.uid);
  const response = state.responses.get(question.uid);
  if (response?.submitted && question.type !== "subjective") {
    response.correct = sameAnswer(response.selected, question.answer);
  }
  saveProgress();
  closeCorrector();
  renderPractice();
  if (isTeacher()) {
    try {
      await correctionApi.remove(question.bankId, question.id);
      showToast("已恢复原题，后端题库同步撤销");
      return;
    } catch (error) {
      showToast(`已恢复本机原题，同步后端失败：${error.message}`);
      return;
    }
  }
  showToast("已恢复原题");
}

function submitCurrent() {
  const question = state.pool[state.index];
  const response = responseFor(question);
  if (question.type === "subjective") {
    if (!(response.text || "").trim()) {
      showToast("请先写下你的作答");
      return;
    }
    // 主观题不判分：提交后进入“对照参考答案自评”
    response.staged = true;
    saveProgress();
    renderPractice();
    return;
  }
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
  state.settings.qtype = QTYPE_MODES.includes(session.qtype) ? session.qtype : "all";
  state.index = Math.min(Math.max(Number(session.index) || 0, 0), pool.length - 1);
  return true;
}

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
  startPool([button.dataset.id], state.settings.scope, state.settings.qtype);
});

ui.selectAll.addEventListener("click", () => {
  state.banks.forEach((bank) => state.selected.add(bank.id));
  renderSetup();
});

ui.selectNone.addEventListener("click", () => {
  state.banks.forEach((bank) => state.selected.delete(bank.id));
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

ui.typeModes.addEventListener("click", (event) => {
  const button = event.target.closest(".segment");
  if (!button) return;
  state.settings.qtype = button.dataset.qtype;
  writeStore(SETTINGS_KEY, state.settings);
  renderSetup();
});

ui.autoNext.addEventListener("change", () => {
  state.settings.autoNext = ui.autoNext.checked;
  writeStore(SETTINGS_KEY, state.settings);
});

ui.startPractice.addEventListener("click", () => {
  startPool([...state.selected], state.settings.scope, state.settings.qtype);
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
  const type = ui.correctType.value;
  syncCorrectorFields(type);
  if (type === "subjective") {
    ui.correctOptions.innerHTML = "";
    return;
  }
  if (type !== "judge") return;
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
  startPool(state.poolBankIds, "wrong", state.settings.qtype).then((ok) => {
    if (ok) showToast(`已开始练习 ${state.pool.length} 道错题`);
  });
});

document.addEventListener("keydown", (event) => {
  // 图片放大层打开时，快捷键全部交给它（Esc 关闭）
  if (!ui.lightbox.hidden) return;
  if (!ui.authModal.hidden) {
    // 登录门禁不可关闭；只有已登录时主动打开的登录框才能 Esc 关掉
    if (event.key === "Escape" && getSession()) ui.authModal.hidden = true;
    return;
  }
  if (!ui.correctView.hidden) {
    // 校正面板打开时不再响应刷题快捷键，Esc 关闭面板
    if (event.key === "Escape") closeCorrector();
    return;
  }
  if (!ui.feedbackModal.hidden || !ui.inboxModal.hidden) {
    if (event.key === "Escape") {
      ui.feedbackModal.hidden = true;
      ui.inboxModal.hidden = true;
    }
    return;
  }
  if (ui.practiceView.hidden) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // 在输入框/文本域里打字时不劫持按键
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
  ) {
    if (event.key === "Escape") target.blur();
    return;
  }
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
  if (Number.isInteger(digit) && digit >= 1 && digit <= 9 && question.type !== "subjective") {
    const response = responseFor(question);
    if (response.submitted) return;
    const input = ui.qOptions.querySelectorAll("input")[digit - 1];
    if (!input) return;
    event.preventDefault();
    input.checked = question.type === "multiple" ? !input.checked : true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

let account = null;
let feedbackUI = null;
// 题库只在登录后加载：未登录时看不到题库，也进不了刷题页
let banksReady = false;
let banksLoading = null;

function renderRoleUI() {
  ui.correctButton.hidden = !isTeacher();
  if (state.pool.length && !ui.practiceView.hidden) renderPractice();
}

/** 未登录 / 退出登录：清空题库与练习状态，退回登录门禁 */
function resetToGate() {
  state.banks = [];
  state.selected.clear();
  state.pool = [];
  state.poolBankIds = [];
  state.index = 0;
  banksReady = false;
  banksLoading = null;
  ui.setupView.hidden = true;
  ui.practiceView.hidden = true;
  ui.correctView.hidden = true;
  ui.feedbackModal.hidden = true;
  ui.inboxModal.hidden = true;
  ui.lightbox.hidden = true;
}

async function syncAuthState(session) {
  renderRoleUI();
  feedbackUI?.refreshBadge();
  if (!session) {
    resetToGate();
    return;
  }
  if (!banksReady) {
    banksLoading =
      banksLoading ||
      refreshBanks().then(() => {
        banksReady = true;
      });
    await banksLoading;
    // 默认全选，不自动恢复上次练习
    if (!state.selectionReady && !state.selected.size) {
      state.banks.forEach((bank) => state.selected.add(bank.id));
    }
    state.selectionReady = true;
  }
  if (ui.practiceView.hidden) enterSetup();
  else renderPractice();
}

account = initAccountUI({ showToast, onSessionChange: syncAuthState });
initImageLightbox();
feedbackUI = initFeedbackUI({
  showToast,
  getCurrentQuestion: () => state.pool[state.index],
  locateQuestion,
});

async function init() {
  loadSettings();
  loadProgress();
  // 恢复登录态：有效才加载题库并进入，否则停在登录门禁
  await account.restore();
}

init();

const SOURCE_PDF_NAMES = {
  北京: ["2026年高考北京卷化学高考真题（学生版）.pdf", "2026年高考北京卷化学高考真题（答案版）.pdf"],
  重庆: ["2026年高考重庆卷化学高考真题（学生版）.pdf", "2026年高考重庆卷化学高考真题（答案版）.pdf"],
  广东: ["2026年高考广东卷化学高考真题（学生版）.pdf", "2026年高考广东卷化学高考真题（答案版）.pdf"],
  贵州: ["2026年高考贵州卷化学高考真题（学生版）.pdf", "2026年高考贵州卷化学高考真题（答案版）.pdf"],
  河北: ["2026年高考河北卷化学高考真题（学生版）.pdf", "2026年高考河北卷化学高考真题（答案版）.pdf"],
  河南: ["2026年高考河南卷化学高考真题（学生版）.pdf", "2026年高考河南卷化学高考真题（答案版）.pdf"],
  黑吉辽蒙: ["2026年高考黑吉辽蒙卷化学高考真题（学生版）.pdf", "2026年高考黑吉辽蒙卷化学高考真题（答案版）.pdf"],
  湖北: ["2026年高考湖北卷化学高考真题（学生版）.pdf", "2026年高考湖北卷化学高考真题（答案版）.pdf"],
  湖南: ["2026年高考湖南卷化学高考真题（学生版）.pdf", "2026年高考湖南卷化学高考真题（答案版）.pdf"],
  云南: ["2026年高考化学真题（云南卷）（学生版）.pdf", "2026年高考化学真题（云南卷）（答案版）.pdf"],
  江苏: ["2026年高考江苏卷化学高考真题（学生版）.pdf", "2026年高考江苏卷化学高考真题（答案版）.pdf"],
  江西: ["2026年高考江西卷化学高考真题（学生版）.pdf", "2026年高考江西卷化学高考真题（答案版）.pdf"],
  山东: ["2026年高考山东卷化学高考真题 学生版.pdf", "2026年高考山东卷化学高考真题 答案版.pdf"],
  陕晋青宁: ["2026年高考陕晋青宁卷化学高考真题（学生版）.pdf", "2026年高考陕晋青宁卷化学高考真题（答案版）.pdf"],
  上海: ["2026年高考上海卷化学高考真题.pdf", "2026年高考上海卷化学高考真题答案.pdf"],
  四川: ["2026年高考四川卷化学高考真题（学生版）.pdf", "2026年高考四川卷化学高考真题（答案版）.pdf"],
};

function loadPdfPreview(question) {
  const match = (question?.bankName || "").match(/（([^）]+)）/);
  const region = match?.[1];
  const names = question?.source === "builtin" ? SOURCE_PDF_NAMES[region] : null;
  if (!names) {
    ui.correctPdfSources.innerHTML = '<div class="correct-pdf-empty">没有找到本题对应的原卷 PDF</div>';
    return;
  }
  const page = Math.max(1, Number(question.sourcePage) || 1);
  ui.correctPdfSources.innerHTML = names.map((name, index) => `
    <section class="correct-pdf-card">
      <header><strong>${index === 0 ? "学生版" : "答案版"}</strong><span>${region} · 第 ${page} 页</span></header>
      <iframe title="${region}化学真题${index === 0 ? "学生版" : "答案版"}" src="/source-pdfs/${encodeURIComponent(name)}#page=${page}&toolbar=1&navpanes=0"></iframe>
    </section>`).join("");
}
