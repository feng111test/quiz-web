import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeVisionAnswer, toVisionQuestion, visionQuestionsFromPayload } from "../vision-questions.js";

describe("vision-questions 视觉 AI 题目规范化", () => {
  it("normalizeVisionAnswer 单选返回大写字母", () => {
    assert.strictEqual(normalizeVisionAnswer("a", "single"), "A");
    assert.strictEqual(normalizeVisionAnswer("B", "single"), "B");
    assert.strictEqual(normalizeVisionAnswer("", "single"), "");
  });

  it("normalizeVisionAnswer 多选去重排序", () => {
    assert.strictEqual(normalizeVisionAnswer("b, a, B", "multiple"), "A,B");
    assert.strictEqual(normalizeVisionAnswer("A, B, C", "multiple"), "A,B,C");
  });

  it("normalizeVisionAnswer 判断题映射", () => {
    assert.strictEqual(normalizeVisionAnswer("正确", "judge"), "正确");
    assert.strictEqual(normalizeVisionAnswer("对", "judge"), "正确");
    assert.strictEqual(normalizeVisionAnswer("√", "judge"), "正确");
    assert.strictEqual(normalizeVisionAnswer("错误", "judge"), "错误");
    assert.strictEqual(normalizeVisionAnswer("×", "judge"), "错误");
    assert.strictEqual(normalizeVisionAnswer("未知", "judge"), "");
  });

  it("toVisionQuestion 未知类型默认为 single", () => {
    const q = toVisionQuestion({ title: "标题", answer: "A" }, 1);
    assert.strictEqual(q.type, "single");
    assert.strictEqual(q.sourcePage, 1);
    assert.strictEqual(q.aiSuggested, true);
    assert.strictEqual(q.reviewed, false);
  });

  it("toVisionQuestion judge 选项为空数组", () => {
    const q = toVisionQuestion({ type: "judge", title: "判断题", answer: "正确" }, 1);
    assert.strictEqual(q.type, "judge");
    assert.deepStrictEqual(q.options, []);
  });

  it("toVisionQuestion 缺少选项时生成默认 A-D 空选项", () => {
    const q = toVisionQuestion({ type: "single", title: "无选项题", answer: "" }, 1);
    assert.strictEqual(q.options.length, 4);
    assert.strictEqual(q.options[0].key, "A");
    assert.strictEqual(q.options[0].content, "");
  });

  it("visionQuestionsFromPayload 处理数组 payload", () => {
    const result = visionQuestionsFromPayload([
      { title: "题目 1", type: "single", answer: "A" },
      { title: "", type: "single", answer: "B" },
    ], 1);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "题目 1");
  });

  it("visionQuestionsFromPayload 处理 { questions: [...] } payload", () => {
    const result = visionQuestionsFromPayload(
      { questions: [{ title: "嵌套题目", type: "single", answer: "C" }] },
      2
    );
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].sourcePage, 2);
  });

  it("visionQuestionsFromPayload 空输入返回空数组", () => {
    assert.deepStrictEqual(visionQuestionsFromPayload([], 1), []);
    assert.deepStrictEqual(visionQuestionsFromPayload({}, 1), []);
  });
});