// Word 公式图片匹配：按「题号所在页 + 顺序游标」把图片依次填入题干 / 选项 / 答案 / 解析。
// 试卷里的公式图大多是浮动图，锚定在每页第一个段落上，和题号所在段落往往不在同一段，
// 只按“段落区间”取图会让跨页的题目（题号正好在页首附近）拿不到自己那一页的公式。
import { formulaCount } from "../../src/question-text.js";

// 公式图片通常很矮；过滤掉关系图/装置图等大图，避免占用公式占位符。
const FORMULA_IMAGE_MAX_HEIGHT = 80;

function isFormulaImage(image) {
  return image.height > 0 && image.height <= FORMULA_IMAGE_MAX_HEIGHT;
}

/** 按文中出现顺序排列的填图目标：题干 → 选项 → 答案 → 解析 */
function buildTargets(question) {
  return [
    { text: question.title, setImages: (images) => (question.titleImages = images) },
    ...(question.options || []).map((option) => ({
      text: option.content,
      setImages: (images) => (option.formulaImages = images),
    })),
    { text: question.answerText || "", setImages: (images) => (question.answerTextImages = images) },
    { text: question.explanation || "", setImages: (images) => (question.explanationImages = images) },
  ]
    .map((target) => ({ ...target, count: formulaCount(target.text) }))
    .filter((target) => target.count > 0);
}

/** 段落落在哪一页：页锚段落 ≤ 段落号的最后一页 */
export function pageOfParagraph(imagePages, paragraphIndex) {
  let found = 0;
  imagePages.forEach((page, index) => {
    if (page.paragraphIndex <= paragraphIndex) found = index;
  });
  return found;
}

/**
 * 从游标开始顺序取公式图片，最多 count 张，且不越过 endPage。
 * 游标是 { page, row, index }，index 表示行内取到第几张——同一行可能并排多张公式图。
 */
export function takeFormulaImages(imagePages, cursor, endPage, count) {
  const images = [];
  let page = cursor.page;
  let row = cursor.row;
  let index = cursor.index || 0;
  let last = null;

  while (images.length < count && page <= endPage && page < imagePages.length) {
    const rows = imagePages[page].rows || [];
    if (row >= rows.length) {
      page += 1;
      row = 0;
      index = 0;
      continue;
    }
    const list = rows[row].images.filter(isFormulaImage);
    while (images.length < count && index < list.length) {
      images.push(list[index]);
      last = { page, row, index };
      index += 1;
    }
    if (images.length < count) {
      row += 1;
      index = 0;
    }
  }

  return {
    images,
    cursor: last ? { page: last.page, row: last.row, index: last.index + 1 } : { page, row, index },
  };
}

/**
 * 给整份题库分配公式图片。
 * @param {Array} questions 解析出的题目（带 number / title / options / answerText / explanation）
 * @param {Array} imagePages [{ paragraphIndex, rows: [{ y, images }] }]
 * @param {Map<Number, Number>} questionStarts 题号 → 题号所在顶层段落下标
 * @param {Number} paragraphCount 正文顶层段落总数
 */
export function assignFormulaImages(questions, imagePages, questionStarts, paragraphCount) {
  if (!imagePages.length) return;
  const lastPage = imagePages.length - 1;
  let cursor = { page: 0, row: 0 };

  questions.forEach((question) => {
    const start = questionStarts?.get(question.number);
    const end = questionStarts?.get(question.number + 1);
    // 题号所在页：题目常从这一页的中段开始，图片却锚在页首段落上
    const startPage = start === undefined ? cursor.page : pageOfParagraph(imagePages, start);
    const endPage = end === undefined ? lastPage : pageOfParagraph(imagePages, end);
    // 游标只前进：上一题没用完的本页图片归上一题，本题从自己那一页重新开始
    if (cursor.page < startPage) cursor = { page: startPage, row: 0 };

    for (const target of buildTargets(question)) {
      const result = takeFormulaImages(imagePages, cursor, endPage, target.count);
      target.setImages(result.images);
      cursor = result.cursor;
    }
  });
}

/** 仪器/实验表格的大图：单独按尺寸匹配，不占用公式占位符 */
export function matchQuestionSourceTable(question, imagePages, cursor) {
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
