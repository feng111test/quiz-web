const DEFAULT_OPTION_KEYS = ["A", "B", "C", "D"];
const JUDGE_TRUE_WORDS = ["正确", "对", "√", "T", "TRUE", "A"];
const JUDGE_FALSE_WORDS = ["错误", "错", "×", "X", "F", "FALSE", "B"];

function blankOptions() {
  return DEFAULT_OPTION_KEYS.map((key) => ({ key, content: "" }));
}

function optionKeyOf(index) {
  return String.fromCharCode(65 + Math.min(Math.max(index, 0), 25));
}

export function normalizeVisionAnswer(raw, type) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (type === "judge") {
    if (JUDGE_TRUE_WORDS.includes(value)) return "正确";
    if (JUDGE_FALSE_WORDS.includes(value)) return "错误";
    return "";
  }
  const keys = [...new Set(
    value
      .split(/[,，、\s]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((key) => /^[A-Z]$/.test(key)),
  )].sort();
  return keys.join(",");
}

export function toVisionQuestion(item, pageNumber) {
  const type = item?.type === "multiple" ? "multiple" : item?.type === "judge" ? "judge" : "single";
  const options = (Array.isArray(item?.options) ? item.options : [])
    .map((option, index) => {
      const rawKey = String(option?.key ?? "").trim().toUpperCase();
      return {
        key: /^[A-F]$/.test(rawKey) ? rawKey : optionKeyOf(index),
        content: String(option?.content ?? option?.text ?? "").trim(),
      };
    })
    .filter((option) => option.content);

  return {
    id: "",
    type,
    title: String(item?.title ?? "").trim(),
    options: type === "judge" ? [] : options.length ? options : blankOptions(),
    answer: normalizeVisionAnswer(item?.answer, type),
    explanation: String(item?.explanation ?? "").trim(),
    images: [],
    sourcePage: pageNumber,
    reviewed: false,
    aiSuggested: true,
    figureHint: item?.hasFigure === true,
  };
}

export function visionQuestionsFromPayload(payload, pageNumber) {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.questions)
      ? payload.questions
      : [];
  return raw
    .map((item) => toVisionQuestion(item, pageNumber))
    .filter((question) => question.title);
}
