import { formulaCount } from "./question-text.js";

const JUDGE_OPTIONS = [
  { key: "正确", content: "正确" },
  { key: "错误", content: "错误" },
];
const JUDGE_TRUE_KEYS = ["A", "正确", "对", "√", "T"];
const JUDGE_FALSE_KEYS = ["B", "错误", "错", "×", "X", "F"];

function toText(value) {
  return String(value ?? "").trim();
}

function normalizeKeys(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\s]+/);
  return [...new Set(items.map((item) => toText(item).toUpperCase()).filter(Boolean))];
}

function imageSrc(image) {
  if (!image) return "";
  if (typeof image === "string") return image;
  return String(image.src || image.dataUrl || "");
}

function readImages(list) {
  return (Array.isArray(list) ? list : [])
    .map(imageSrc)
    .filter((src) => src.startsWith("data:"))
    .map((src) => ({ src }));
}

function splitTitleImages(title, images) {
  return formulaCount(title) > 0 ? { inline: images, figures: [] } : { inline: [], figures: images };
}

function fromWord(raw, bank, index) {
  const id = toText(raw?.id) || `word-${index + 1}`;
  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((option) => ({
      key: toText(option?.key),
      content: toText(option?.content ?? option?.text),
      formulaImages: readImages(option?.formulaImages),
    }))
    .filter((option) => option.content);

  const answer = normalizeKeys(raw?.answer);
  if (!answer.length || options.length < 2) return null;

  const title = toText(raw?.title ?? raw?.stem);
  if (!title) return null;

  const titleImages = readImages(raw?.titleImages);
  const { inline, figures } = splitTitleImages(title, titleImages);

  return {
    uid: `${bank.id}::${id}`,
    id,
    bankId: bank.id,
    bankName: bank.name,
    source: "word",
    type: raw?.type === "multiple" || answer.length > 1 ? "multiple" : "single",
    title,
    titleImages: inline,
    images: [...figures, ...readImages(raw?.tableImage ? [raw.tableImage] : [])],
    options,
    answer,
    explanation: toText(raw?.explanation),
    explanationImages: readImages(raw?.explanationImages),
    sourcePage: 0,
  };
}

function fromPdf(raw, bank, index) {
  const id = toText(raw?.id) || `pdf-${index + 1}`;
  const type = raw?.type === "multiple" ? "multiple" : raw?.type === "judge" ? "judge" : "single";
  const rawOptions = (Array.isArray(raw?.options) ? raw.options : [])
    .map((option) => ({ key: toText(option?.key), content: toText(option?.content ?? option?.text) }))
    .filter((option) => option.content);

  let keys = normalizeKeys(raw?.answer);
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
  if (!keys.length) return null;

  const title = toText(raw?.title ?? raw?.stem);
  if (!title) return null;

  const options = type === "judge" ? JUDGE_OPTIONS : rawOptions;
  if (options.length < 2) return null;

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
    explanation: toText(raw?.explanation),
    explanationImages: [],
    sourcePage: Number(raw?.sourcePage) || 0,
  };
}

function fromBuiltin(raw, bank, index) {
  const id = toText(raw?.id) || `builtin-${index + 1}`;
  const type = raw?.type === "multiple" ? "multiple" : raw?.type === "judge" ? "judge" : "single";
  const answer = normalizeKeys(raw?.answer);
  const title = toText(raw?.title ?? raw?.stem);
  const rawOptions = (Array.isArray(raw?.options) ? raw.options : [])
    .map((option) => ({
      key: toText(option?.key),
      content: toText(option?.content ?? option?.text),
      formulaImages: readImages(option?.formulaImages),
    }))
    .filter((option) => option.content);

  if (!title || !answer.length) return null;
  const options = type === "judge" ? JUDGE_OPTIONS : rawOptions;
  if (options.length < 2) return null;

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
