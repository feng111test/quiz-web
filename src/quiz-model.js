import { formulaCount } from "./question-text.js";

const JUDGE_OPTIONS = [
  { key: "正确", content: "正确" },
  { key: "错误", content: "错误" },
];
const JUDGE_TRUE_KEYS = ["A", "正确", "对", "√", "T"];
const JUDGE_FALSE_KEYS = ["B", "错误", "错", "×", "X", "F"];
/** 与小程序一致：填空、简答、计算、实验、推断、材料题统一归到 subjective */
export const QUESTION_TYPES = ["single", "multiple", "judge", "subjective"];

function toText(value) {
  return String(value ?? "").trim();
}

function normalizeKeys(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\s]+/);
  return [...new Set(items.map((item) => toText(item).toUpperCase()).filter(Boolean))];
}

/** 主观题的参考答案是一整段文字（小程序里存成 answer: ["整段文字"]） */
function toAnswerText(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return toText(value);
}

function resolveType(raw) {
  const rawType = toText(raw?.type).toLowerCase();
  return QUESTION_TYPES.includes(rawType) ? rawType : "single";
}

function imageSrc(image) {
  if (!image) return "";
  if (typeof image === "string") return image;
  return String(image.src || image.dataUrl || "");
}

/** 图片有三种形态：base64（教师上传/截图）、绝对地址、外置图片的相对路径（builtin-data 下） */
export function resolveImageSrc(src) {
  if (!src) return "";
  if (/^(data:|blob:|https?:|\/\/)/i.test(src)) return src;
  // Node / 单元测试里没有 DOM，原样返回，避免 new URL 报错
  if (typeof document === "undefined") return src;
  const base = import.meta.env?.BASE_URL || "/";
  return new URL(`${base}builtin-data/${src}`, document.baseURI).href;
}

function readImages(list) {
  return (Array.isArray(list) ? list : [])
    .map(imageSrc)
    .filter(Boolean)
    .map((src) => ({ src: resolveImageSrc(src) }));
}

function splitTitleImages(title, images) {
  return formulaCount(title) > 0 ? { inline: images, figures: [] } : { inline: [], figures: images };
}

function fromWord(raw, bank, index) {
  const id = toText(raw?.id) || `word-${index + 1}`;
  const type = resolveType(raw);
  const answerText = type === "subjective" ? toAnswerText(raw?.answer ?? raw?.answerText) : "";
  const answer = type === "subjective" ? [] : normalizeKeys(raw?.answer);
  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((option) => ({
      key: toText(option?.key),
      content: toText(option?.content ?? option?.text),
      formulaImages: readImages(option?.formulaImages),
    }))
    .filter((option) => option.content);

  const title = toText(raw?.title ?? raw?.stem);
  if (!title) return null;
  if (type === "subjective") {
    if (!answerText) return null;
  } else if (!answer.length || options.length < 2) {
    return null;
  }

  const titleImages = readImages(raw?.titleImages);
  const { inline, figures } = splitTitleImages(title, titleImages);

  return {
    uid: `${bank.id}::${id}`,
    id,
    bankId: bank.id,
    bankName: bank.name,
    source: "word",
    type: type === "subjective" ? "subjective" : answer.length > 1 ? "multiple" : type,
    title,
    titleImages: inline,
    images: [...figures, ...readImages(raw?.tableImage ? [raw.tableImage] : [])],
    options: type === "subjective" ? [] : options,
    answer,
    answerText,
    explanation: toText(raw?.explanation),
    explanationImages: readImages(raw?.explanationImages),
    sourcePage: 0,
  };
}

function fromPdf(raw, bank, index) {
  const id = toText(raw?.id) || `pdf-${index + 1}`;
  const type = resolveType(raw);
  const answerText = type === "subjective" ? toAnswerText(raw?.answer ?? raw?.answerText) : "";
  const rawOptions = (Array.isArray(raw?.options) ? raw.options : [])
    .map((option) => ({ key: toText(option?.key), content: toText(option?.content ?? option?.text) }))
    .filter((option) => option.content);

  let keys = type === "subjective" ? [] : normalizeKeys(raw?.answer);
  if (type === "judge") {
    keys = keys
      .map((key) =>
        JUDGE_TRUE_KEYS.includes(key)
          ? "正确"
          : JUDGE_FALSE_KEYS.includes(key)
            ? "错误"
            : key,
      )
      .filter((key) => key === "正确" || key === "错误");
  }

  const title = toText(raw?.title ?? raw?.stem);
  if (!title) return null;
  if (type === "subjective") {
    if (!answerText) return null;
  } else {
    if (!keys.length) return null;
    if ((type === "judge" ? JUDGE_OPTIONS : rawOptions).length < 2) return null;
  }

  const options = type === "judge" ? JUDGE_OPTIONS : type === "subjective" ? [] : rawOptions;

  return {
    uid: `${bank.id}::${id}`,
    id,
    bankId: bank.id,
    bankName: bank.name,
    source: "pdf",
    type,
    title,
    titleImages: [],
    images: readImages(raw?.images),
    options: options.map((option) => ({ ...option, formulaImages: [] })),
    answer: keys,
    answerText,
    explanation: toText(raw?.explanation),
    explanationImages: [],
    sourcePage: Number(raw?.sourcePage) || 0,
  };
}

function fromBuiltin(raw, bank, index) {
  const id = toText(raw?.id) || `builtin-${index + 1}`;
  const type = resolveType(raw);
  const answerText = type === "subjective" ? toAnswerText(raw?.answer ?? raw?.answerText) : "";
  const answer = type === "subjective" ? [] : normalizeKeys(raw?.answer);
  const title = toText(raw?.title ?? raw?.stem);
  const rawOptions = (Array.isArray(raw?.options) ? raw.options : [])
    .map((option) => ({
      key: toText(option?.key),
      content: toText(option?.content ?? option?.text),
      formulaImages: readImages(option?.formulaImages),
    }))
    .filter((option) => option.content);

  if (!title) return null;
  const options = type === "judge" ? JUDGE_OPTIONS : type === "subjective" ? [] : rawOptions;
  if (type === "subjective") {
    if (!answerText) return null;
  } else if (!answer.length || options.length < 2) {
    return null;
  }

  const { inline, figures } = splitTitleImages(title, readImages(raw?.titleImages));
  return {
    uid: `${bank.id}::${id}`,
    id,
    bankId: bank.id,
    bankName: bank.name,
    source: "builtin",
    type,
    title,
    titleImages: inline,
    images: [...readImages(raw?.images), ...figures, ...readImages(raw?.tableImage ? [raw.tableImage] : [])],
    options: options.map((option) => ({ ...option, formulaImages: option.formulaImages || [] })),
    answer,
    answerText,
    explanation: toText(raw?.explanation),
    explanationImages: readImages(raw?.explanationImages),
    sourcePage: Number(raw?.sourcePage) || 0,
  };
}

export function toQuizQuestions(bank) {
  if (!bank || !Array.isArray(bank.questions)) return [];
  const converter = bank.source === "builtin" ? fromBuiltin : bank.source === "pdf" ? fromPdf : fromWord;
  const seen = new Set();
  return bank.questions
    .map((raw, index) => converter(raw, bank, index))
    .filter(Boolean)
    .filter((question) => {
      if (seen.has(question.uid)) return false;
      seen.add(question.uid);
      return true;
    });
}

export function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function sameAnswer(selected, answer) {
  const left = [...selected].sort();
  const right = [...answer].sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
