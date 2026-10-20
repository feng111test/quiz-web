const BANK_FILE_FORMAT = "local-question-bank-v1";
const OPTION_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function optionKey(index) {
  return OPTION_KEYS[index] || `选项${index + 1}`;
}

function safeFileName(name) {
  return String(name || "题库").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function readImages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((image) => ({
      dataUrl: String(image?.dataUrl || image?.src || ""),
      page: Number.isInteger(Number(image?.page)) && Number(image.page) > 0 ? Number(image.page) : undefined,
    }))
    .filter((image) => image.dataUrl.startsWith("data:"));
}

function normalizeAnswer(value) {
  let items = [];
  if (Array.isArray(value)) items = value.map((item) => String(item ?? ""));
  else if (typeof value === "string") items = value.split(/[,，、\s]+/);
  else if (typeof value === "number") items = [String(value)];
  const cleaned = items.map((item) => item.trim().toUpperCase()).filter(Boolean);
  return [...new Set(cleaned)];
}

function toCanonicalQuestion(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions.map((option, optionIndex) => ({
    key: String(option?.key ?? optionKey(optionIndex)).trim() || optionKey(optionIndex),
    content: String(option?.content ?? option?.text ?? "").trim(),
    formulaImages: readImages(option?.formulaImages),
  }));
  const answer = normalizeAnswer(raw.answer);
  const title = String(raw.title ?? raw.stem ?? "").trim();
  if (!title && !options.length) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `imported-${index + 1}`,
    type: ["single", "multiple", "judge"].includes(raw.type) ? raw.type : answer.length > 1 ? "multiple" : "single",
    title: title || "未填写题干",
    sourcePage: Number.isInteger(Number(raw.sourcePage)) && Number(raw.sourcePage) > 0 ? Number(raw.sourcePage) : undefined,
    reviewed: Boolean(raw.reviewed),
    options,
    answer,
    explanation: String(raw.explanation ?? "").trim(),
    images: readImages(raw.images),
    explanationImages: readImages(raw.explanationImages),
    titleImages: readImages(raw.titleImages),
    tableImage: raw.tableImage ? readImages([raw.tableImage])[0] || null : null,
    sourceTable: raw.sourceTable ? String(raw.sourceTable) : "",
  };
}

export function downloadBankFile({ name, source, questions }) {
  const payload = {
    format: BANK_FILE_FORMAT,
    name: name || "题库",
    source: source || "unknown",
    exportedAt: new Date().toISOString(),
    questions: (questions || []).map(toCanonicalQuestion).filter(Boolean),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(payload.name)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return payload.questions.length;
}

export async function readBankFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  const list = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(list)) throw new Error("文件里没有题目列表");

  const questions = list.map(toCanonicalQuestion).filter(Boolean);
  if (!questions.length) throw new Error("文件里没有可导入的题目");

  const usedIds = new Set();
  questions.forEach((question, index) => {
    let id = question.id || `imported-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    question.id = id;
  });

  const name =
    (typeof data?.name === "string" && data.name.trim()) ||
    (typeof file?.name === "string" ? file.name.replace(/\.json$/i, "") : "导入的题库");

  return { name, questions };
}

export function toWordQuestions(questions) {
  return questions.map((question, index) => {
    const isJudge = question.type === "judge";
    const answer = isJudge
      ? [...question.answer].map((key) => (key === "A" ? "正确" : key === "B" ? "错误" : key))
      : [...question.answer];
    return {
      id: question.id,
      number: index + 1,
      title: question.title,
      options: isJudge
        ? [
            { key: "正确", content: "正确", formulaImages: [] },
            { key: "错误", content: "错误", formulaImages: [] },
          ]
        : question.options.map((option) => ({
            key: option.key,
            content: option.content,
            formulaImages: option.formulaImages.map((image) => ({ src: image.dataUrl })),
          })),
      answer: answer.sort(),
      type: question.type === "multiple" ? "multiple" : "single",
      explanation: question.explanation,
      explanationImages: question.explanationImages.map((image) => ({ src: image.dataUrl })),
      titleImages: [...question.images, ...question.titleImages].map((image) => ({ src: image.dataUrl })),
      tableImage: question.tableImage ? { src: question.tableImage.dataUrl } : undefined,
      sourceTable: question.sourceTable,
    };
  });
}

export function toPdfQuestions(questions) {
  return questions.map((question) => ({
    id: question.id,
    type: question.type,
    title: question.title,
    sourcePage: question.sourcePage,
    reviewed: question.reviewed,
    options: question.options.map((option) => ({ key: option.key, content: option.content })),
    answer: question.answer.join(","),
    explanation: question.explanation,
    images: [
      ...question.images,
      ...question.titleImages,
      ...question.explanationImages,
      ...(question.tableImage ? [question.tableImage] : []),
      ...question.options.flatMap((option) => option.formulaImages),
    ].map((image) => ({ page: image.page || question.sourcePage || 1, dataUrl: image.dataUrl })),
  }));
}
