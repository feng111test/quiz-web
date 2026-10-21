import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toQuizQuestions, sameAnswer, shuffle } from "../quiz-model.js";

const builtinBank = {
  id: "builtin-1",
  name: "测试题库",
  source: "builtin",
  questions: [
    {
      id: "q1",
      type: "single",
      title: "单选题干",
      options: [
        { key: "A", content: "选项 A", formulaImages: [] },
        { key: "B", content: "选项 B", formulaImages: [] },
      ],
      answer: "A",
      explanation: "解析",
    },
    {
      id: "q2",
      type: "multiple",
      title: "多选题干",
      options: [
        { key: "A", content: "选项 A", formulaImages: [] },
        { key: "B", content: "选项 B", formulaImages: [] },
      ],
      answer: "A,B",
      explanation: "",
    },
    {
      id: "q3",
      type: "judge",
      title: "判断题干",
      options: [],
      answer: "正确",
      explanation: "",
    },
    {
      id: "q4",
      type: "subjective",
      title: "主观题干",
      options: [],
      answerText: "参考答案文本",
      explanation: "",
    },
  ],
};

describe("quiz-model 题目转换", () => {
  it("toQuizQuestions 转换内置题库，保留题型和答案", () => {
    const result = toQuizQuestions(builtinBank);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0].type, "single");
    assert.strictEqual(result[0].answer[0], "A");
    assert.strictEqual(result[1].type, "multiple");
    assert.deepStrictEqual(result[1].answer, ["A", "B"]);
    assert.strictEqual(result[2].type, "judge");
    assert.strictEqual(result[3].type, "subjective");
    assert.strictEqual(result[3].answerText, "参考答案文本");
  });

  it("toQuizQuestions 去重 uid 相同的题目", () => {
    const bank = {
      ...builtinBank,
      questions: [...builtinBank.questions, { ...builtinBank.questions[0] }],
    };
    const result = toQuizQuestions(bank);
    assert.strictEqual(result.length, 4);
  });

  it("sameAnswer 单选答案相等", () => {
    assert.strictEqual(sameAnswer(["A"], ["A"]), true);
    assert.strictEqual(sameAnswer(["A"], ["B"]), false);
  });

  it("sameAnswer 多选顺序不影响相等判断", () => {
    assert.strictEqual(sameAnswer(["A", "B"], ["B", "A"]), true);
    assert.strictEqual(sameAnswer(["A", "B"], ["A"]), false);
  });

  it("shuffle 不改变元素数量，且包含相同元素", () => {
    const list = [1, 2, 3, 4, 5];
    const shuffled = shuffle(list);
    assert.strictEqual(shuffled.length, 5);
    assert.deepStrictEqual([...shuffled].sort(), [1, 2, 3, 4, 5]);
  });

  it("空题库返回空数组", () => {
    assert.deepStrictEqual(toQuizQuestions(null), []);
    assert.deepStrictEqual(toQuizQuestions({ questions: [] }), []);
  });
});