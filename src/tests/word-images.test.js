import assert from "node:assert/strict";
import test from "node:test";
import { matchQuestionImages } from "../../word-quiz/src/word-images.js";
import { FORMULA_TOKEN } from "../../src/question-text.js";

const image = (id, overrides = {}) => ({
  x: 0,
  y: 0,
  width: 20,
  height: 12,
  src: `data:image/png;base64,${id}`,
  ...overrides,
});

const page = (paragraphIndex, rows) => ({ paragraphIndex, rows });

test("公式图片多于占位符时仍能匹配（不再整题失败）", () => {
  const question = { title: `甲${FORMULA_TOKEN}乙${FORMULA_TOKEN}丙`, options: [] };
  const imagePages = [
    page(10, [{ y: 0, images: [image("1"), image("2"), image("3")] }]),
  ];

  const position = matchQuestionImages(question, imagePages, { page: 0, row: 0 }, { start: 10, end: 20 });

  assert.equal(question.titleImages.length, 2);
  assert.deepEqual(
    question.titleImages.map((item) => item.src.split(",").pop()),
    ["1", "2"],
  );
  assert.equal(position.page, 0);
  assert.equal(position.row, 1);
});

test("公式图片少于占位符时尽量填入，剩余显示占位符", () => {
  const question = {
    title: `${FORMULA_TOKEN}${FORMULA_TOKEN}${FORMULA_TOKEN}${FORMULA_TOKEN}`,
    options: [],
  };
  const imagePages = [page(10, [{ y: 0, images: [image("1"), image("2")] }])];

  matchQuestionImages(question, imagePages, { page: 0, row: 0 }, { start: 10, end: 20 });

  assert.equal(question.titleImages.length, 2);
});

test("关系图等大图不会占用公式占位符", () => {
  const question = { title: `甲${FORMULA_TOKEN}乙`, options: [] };
  const imagePages = [
    page(10, [
      {
        y: 0,
        images: [
          image("graph", { x: 0, y: 0, width: 300, height: 200 }),
          image("formula", { x: 40, y: 0, width: 24, height: 12 }),
        ],
      },
    ]),
  ];

  matchQuestionImages(question, imagePages, { page: 0, row: 0 }, { start: 10, end: 20 });

  assert.equal(question.titleImages.length, 1);
  assert.equal(question.titleImages[0].src.split(",").pop(), "formula");
});

test("只使用题目段落范围内的图片", () => {
  const question = { title: `甲${FORMULA_TOKEN}`, options: [] };
  const imagePages = [
    page(5, [{ y: 0, images: [image("before")] }]),
    page(10, [{ y: 0, images: [image("inside")] }]),
    page(20, [{ y: 0, images: [image("after")] }]),
  ];

  matchQuestionImages(question, imagePages, { page: 0, row: 0 }, { start: 10, end: 20 });

  assert.equal(question.titleImages.length, 1);
  assert.equal(question.titleImages[0].src.split(",").pop(), "inside");
});

test("题干与选项按顺序分配公式图片", () => {
  const question = {
    title: `题干${FORMULA_TOKEN}`,
    options: [{ content: `选项甲${FORMULA_TOKEN}` }, { content: `${FORMULA_TOKEN}选项乙` }],
  };
  const imagePages = [
    page(10, [{ y: 0, images: [image("title"), image("a"), image("b")] }]),
  ];

  matchQuestionImages(question, imagePages, { page: 0, row: 0 }, { start: 10, end: 20 });

  assert.equal(question.titleImages[0].src.split(",").pop(), "title");
  assert.equal(question.options[0].formulaImages[0].src.split(",").pop(), "a");
  assert.equal(question.options[1].formulaImages[0].src.split(",").pop(), "b");
});
