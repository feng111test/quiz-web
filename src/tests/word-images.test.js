import assert from "node:assert/strict";
import test from "node:test";
import { assignFormulaImages } from "../../word-quiz/src/word-images.js";
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
const src = (list) => (list || []).map((item) => item.src.split(",").pop());

function run(questions, imagePages, starts, paragraphCount = 300) {
  assignFormulaImages(questions, imagePages, new Map(starts), paragraphCount);
  return questions;
}

test("公式图片多于占位符时只取需要的", () => {
  const [question] = run(
    [{ number: 1, title: `甲${FORMULA_TOKEN}乙${FORMULA_TOKEN}丙`, options: [] }],
    [page(10, [{ y: 0, images: [image("1"), image("2"), image("3")] }])],
    [[1, 10]],
  );

  assert.deepEqual(src(question.titleImages), ["1", "2"]);
});

test("公式图片少于占位符时尽量填入，剩余显示占位符", () => {
  const [question] = run(
    [{ number: 1, title: `${FORMULA_TOKEN}${FORMULA_TOKEN}${FORMULA_TOKEN}`, options: [] }],
    [page(10, [{ y: 0, images: [image("1"), image("2")] }])],
    [[1, 10]],
  );

  assert.deepEqual(src(question.titleImages), ["1", "2"]);
});

test("关系图等大图不会占用公式占位符", () => {
  const [question] = run(
    [{ number: 1, title: `甲${FORMULA_TOKEN}乙`, options: [] }],
    [
      page(10, [
        {
          y: 0,
          images: [
            image("graph", { width: 300, height: 200 }),
            image("formula", { x: 40, width: 24, height: 12 }),
          ],
        },
      ]),
    ],
    [[1, 10]],
  );

  assert.deepEqual(src(question.titleImages), ["formula"]);
});

test("题干、选项、答案、解析按文中出现顺序依次填入", () => {
  const [question] = run(
    [
      {
        number: 1,
        title: `题干${FORMULA_TOKEN}`,
        options: [{ content: `选项甲${FORMULA_TOKEN}` }],
        answerText: `答案${FORMULA_TOKEN}`,
        explanation: `解析${FORMULA_TOKEN}`,
      },
    ],
    [
      page(10, [
        {
          y: 0,
          images: [image("title"), image("option"), image("answer"), image("explanation")],
        },
      ]),
    ],
    [[1, 10]],
  );

  assert.deepEqual(src(question.titleImages), ["title"]);
  assert.deepEqual(src(question.options[0].formulaImages), ["option"]);
  assert.deepEqual(src(question.answerTextImages), ["answer"]);
  assert.deepEqual(src(question.explanationImages), ["explanation"]);
});

test("跨页题目也能取到题号所在页的公式图片（浮动图锚在页首段落）", () => {
  const [first, second] = run(
    [
      { number: 19, title: `十九${FORMULA_TOKEN}`, options: [] },
      { number: 20, title: `二十${FORMULA_TOKEN}${FORMULA_TOKEN}`, options: [] },
    ],
    [
      page(100, [{ y: 0, images: [image("p1-1"), image("p1-2")] }]),
      page(200, [{ y: 0, images: [image("p2-1"), image("p2-2")] }]),
    ],
    [
      [19, 150],
      [20, 250],
    ],
  );

  assert.deepEqual(src(first.titleImages), ["p1-1"]);
  assert.deepEqual(src(second.titleImages), ["p2-1", "p2-2"]);
});

test("上一页没用完的图片不会串到下一题", () => {
  const [first, second] = run(
    [
      { number: 1, title: `甲${FORMULA_TOKEN}`, options: [] },
      { number: 2, title: `乙${FORMULA_TOKEN}`, options: [] },
    ],
    [
      page(10, [{ y: 0, images: [image("a"), image("b")] }]),
      page(20, [{ y: 0, images: [image("c")] }]),
    ],
    [
      [1, 10],
      [2, 20],
    ],
  );

  assert.deepEqual(src(first.titleImages), ["a"]);
  assert.deepEqual(src(second.titleImages), ["c"]);
});

test("长题目可以继续取到下一页的图片，直到下一题所在页", () => {
  const [first, second] = run(
    [
      { number: 1, title: `${FORMULA_TOKEN}${FORMULA_TOKEN}${FORMULA_TOKEN}`, options: [] },
      { number: 2, title: `${FORMULA_TOKEN}`, options: [] },
    ],
    [
      page(10, [{ y: 0, images: [image("a")] }]),
      page(20, [{ y: 0, images: [image("b"), image("c")] }]),
    ],
    [
      [1, 10],
      [2, 20],
    ],
  );

  assert.deepEqual(src(first.titleImages), ["a", "b", "c"]);
  assert.deepEqual(src(second.titleImages), []);
});
