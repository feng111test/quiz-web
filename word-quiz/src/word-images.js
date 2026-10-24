// Word 公式图片匹配：按题目段落范围内的图片顺序，尽量填入题干/选项中的公式占位符。
// 与原先“必须不多不少刚好匹配”不同，这里允许图片多于或少于占位符，避免整题回退。
import { formulaCount } from "../../src/question-text.js";

// 公式图片通常很矮；过滤掉关系图/装置图等大图，避免占用公式占位符。
const FORMULA_IMAGE_MAX_HEIGHT = 80;

function isFormulaImage(image) {
  return image.height > 0 && image.height <= FORMULA_IMAGE_MAX_HEIGHT;
}

function imagesInRange(imagePages, start, end) {
  const items = [];
  imagePages.forEach((page, pageIndex) => {
    if (page.paragraphIndex < start || page.paragraphIndex >= end) return;
    page.rows.forEach((row, rowIndex) => {
      row.images.filter(isFormulaImage).forEach((image) => {
        items.push({ image, page: pageIndex, row: rowIndex });
      });
    });
  });
  return items;
}

function imagesFromCursor(imagePages, cursor) {
  const items = [];
  for (let pageIndex = Math.max(0, cursor.page); pageIndex < imagePages.length; pageIndex += 1) {
    const page = imagePages[pageIndex];
    page.rows.forEach((row, rowIndex) => {
      if (pageIndex === cursor.page && rowIndex < cursor.row) return;
      row.images.filter(isFormulaImage).forEach((image) => {
        items.push({ image, page: pageIndex, row: rowIndex });
      });
    });
  }
  return items;
}

function buildTargets(question) {
  const targets = [{ text: question.title, setImages: (images) => (question.titleImages = images) }];
  (question.options || []).forEach((option) => {
    targets.push({ text: option.content, setImages: (images) => (option.formulaImages = images) });
  });
  return targets
    .map((target) => ({ ...target, count: formulaCount(target.text) }))
    .filter((target) => target.count > 0);
}

export function matchQuestionImages(question, imagePages, cursor, paragraphRange = null) {
  const targets = buildTargets(question);
  if (!targets.length) return null;

  const items = paragraphRange
    ? imagesInRange(imagePages, paragraphRange.start, paragraphRange.end)
    : imagesFromCursor(imagePages, cursor);

  let offset = 0;
  let last = null;
  for (const target of targets) {
    const take = items.slice(offset, offset + target.count);
    if (take.length) {
      target.setImages(take.map((item) => item.image));
      last = take[take.length - 1];
      offset += take.length;
    }
  }
  if (!last) return null;
  return { page: last.page, row: last.row + 1 };
}

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

export function collectExplanationImages(question, imagePages, cursor, endCursor) {
  let remaining = formulaCount(question.explanation);
  if (!remaining) return cursor;

  const images = [];
  let page = cursor.page;
  let row = cursor.row;
  while (
    page < imagePages.length &&
    remaining > 0 &&
    (page < endCursor.page || (page === endCursor.page && row < endCursor.row))
  ) {
    const rows = imagePages[page].rows;
    while (
      row < rows.length &&
      remaining > 0 &&
      (page < endCursor.page || (page === endCursor.page && row < endCursor.row))
    ) {
      const rowImages = rows[row].images;
      images.push(...rowImages);
      remaining -= rowImages.length;
      row += 1;
    }
    if (remaining > 0) {
      page += 1;
      row = 0;
    }
  }

  question.explanationImages = images;
  return { page, row };
}
