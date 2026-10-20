/**
 * 题目校正：把校对结果按题目唯一 ID 存在本机，加载题库时再叠加回题目。
 * 内置真题题库不落 IndexedDB，校正内容单独保存，避免整份题库被复制一份。
 */

const CORRECTION_KEY = "exam-workspace:quiz:corrections";

function readAll() {
  try {
    const raw = localStorage.getItem(CORRECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[校正] 读取记录失败", error);
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(CORRECTION_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn("[校正] 保存记录失败", error);
  }
}

export function getCorrection(uid) {
  return readAll()[uid] || null;
}

/**
 * @param {String} uid
 * @param {Object|null} patch 传 null 表示清除校正
 * @param {Object} [original] 首次校正时的原题字段，用于“恢复原题”
 */
export function saveCorrection(uid, patch, original) {
  const map = readAll();
  if (!patch) {
    delete map[uid];
  } else {
    const previous = map[uid];
    map[uid] = {
      ...patch,
      original: previous?.original || original || null,
      correctedAt: Date.now(),
    };
  }
  writeAll(map);
}

export function clearCorrection(uid) {
  saveCorrection(uid, null);
}

function optionImages(question, key) {
  const matched = question.options.find((option) => option.key === key);
  return matched ? matched.formulaImages || [] : [];
}

/** 把校正内容叠加到题目上（不改原题数据） */
export function applyCorrections(questions) {
  const map = readAll();
  if (!Object.keys(map).length) return questions;
  return questions.map((question) => {
    const patch = map[question.uid];
    if (!patch) return question;
    const options = Array.isArray(patch.options) && patch.options.length
      ? patch.options.map((option) => ({
          key: option.key,
          content: option.content,
          formulaImages: optionImages(question, option.key),
        }))
      : question.options;
    return {
      ...question,
      type: patch.type || question.type,
      title: typeof patch.title === "string" ? patch.title : question.title,
      options,
      answer: Array.isArray(patch.answer) && patch.answer.length ? [...patch.answer] : question.answer,
      explanation: typeof patch.explanation === "string" ? patch.explanation : question.explanation,
      corrected: true,
    };
  });
}
