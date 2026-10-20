export const FORMULA_TOKEN = "\uE000";
export const FORMULA_FALLBACK_TEXT = "原文公式图片未能匹配";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formulaCount(text) {
  return String(text ?? "").split(FORMULA_TOKEN).length - 1;
}

export function renderFormulaContent(text, images = [], fallback = FORMULA_FALLBACK_TEXT) {
  const parts = String(text ?? "").split(FORMULA_TOKEN);
  return parts
    .map((part, index) => {
      const image = images[index];
      const formula = image
        ? `<img class="formula-image formula-inline" src="${escapeHtml(image.src)}" alt="原文公式">`
        : index < parts.length - 1
          ? `<span class="formula-missing">${escapeHtml(fallback)}</span>`
          : "";
      return `${escapeHtml(part)}${formula}`;
    })
    .join("");
}
