import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCanonicalQuestion, readBankFile, toWordQuestions, toPdfQuestions } from "../bank-file.js";

describe("bank-file 题库导入导出规范化", () => {
  it("toCanonicalQuestion 规范化单选题", () => {
    const raw = {
      type: "single",
      title: "标题",
      options: [
        { key: "A", content: "内容 A" },
        { key: "B", content: "内容 B" },
      ],
      answer: "a",
    };
    const q = toCanonicalQuestion(raw, 0);
    assert.ok(q);
    assert.strictEqual(q.type, "single");
    assert.strictEqual(q.title, "标题");
    assert.deepStrictEqual(q.answer, ["A"]);
    assert.strictEqual(q.options.length, 2);
    assert.strictEqual(q.options[0].key, "A");
  });

  it("toCanonicalQuestion 规范化主观题，answer 为空数组，answerText 保存文本", () => {
    const raw = {
      type: "subjective",
      title: "简答题",
      answer: "这是参考答案",
    };
    const q = toCanonicalQuestion(raw, 0);
    assert.ok(q);
    assert.strictEqual(q.type, "subjective");
    assert.deepStrictEqual(q.answer, []);
    assert.strictEqual(q.answerText, "这是参考答案");
  });

  it("toCanonicalQuestion 返回 null 为无效数据", () => {
    assert.strictEqual(toCanonicalQuestion(null, 0), null);
    assert.strictEqual(toCanonicalQuestion({}, 0), null);
    assert.strictEqual(toCanonicalQuestion({ title: "", options: [], answerText: "" }, 0), null);
  });

  it("normalizeAnswer 去重并大写", () => {
    // 通过 toCanonicalQuestion 间接验证
    const q = toCanonicalQuestion({
      type: "multiple",
      title: "多选",
      options: [{ key: "A", content: "A" }, { key: "B", content: "B" }],
      answer: "b, a, B",
    }, 0);
    assert.deepStrictEqual(q.answer, ["A", "B"]);
  });

  it("toWordQuestions 将判断题选项转为 正确/错误", () => {
    const questions = [
      {
        id: "q1",
        type: "judge",
        title: "判断题",
        options: [],
        answer: ["A"],
        explanation: "",
      },
    ];
    const result = toWordQuestions(questions);
    assert.strictEqual(result[0].type, "single");
    assert.strictEqual(result[0].options.length, 2);
    assert.strictEqual(result[0].options[0].key, "正确");
    assert.strictEqual(result[0].options[1].key, "错误");
  });

  it("toWordQuestions 主观题 options 为空", () => {
    const questions = [
      {
        id: "q1",
        type: "subjective",
        title: "主观题",
        options: [],
        answer: [],
        answerText: "参考答案",
        explanation: "",
      },
    ];
    const result = toWordQuestions(questions);
    assert.strictEqual(result[0].type, "subjective");
    assert.strictEqual(result[0].options.length, 0);
  });

  it("toPdfQuestions 主观题 answer 使用 answerText", () => {
    const questions = [
      {
        id: "q1",
        type: "subjective",
        title: "主观题",
        options: [],
        answer: [],
        answerText: "主观参考答案",
        explanation: "",
      },
    ];
    const result = toPdfQuestions(questions);
    assert.strictEqual(result[0].answer, "主观参考答案");
  });

  it("readBankFile 重复 id 自动去重", async () => {
    const content = JSON.stringify({
      name: "测试题库",
      questions: [
        { id: "q1", type: "single", title: "题1", options: [{ key: "A", content: "A" }, { key: "B", content: "B" }], answer: "A" },
        { id: "q1", type: "single", title: "题1 重复", options: [{ key: "A", content: "A" }, { key: "B", content: "B" }], answer: "B" },
      ],
    });
    const file = { name: "test.json", text: () => Promise.resolve(content) };
    const result = await readBankFile(file);
    assert.strictEqual(result.questions.length, 2);
    assert.notStrictEqual(result.questions[0].id, result.questions[1].id);
  });

  it("readBankFile 无效 JSON 抛出错误", async () => {
    const file = { name: "test.json", text: () => Promise.resolve("{not json") };
    await assert.rejects(() => readBankFile(file), /不是有效的 JSON/);
  });

  it("readBankFile 无题目列表抛出错误", async () => {
    const file = { name: "test.json", text: () => Promise.resolve(JSON.stringify({ name: "空" })) };
    await assert.rejects(() => readBankFile(file), /没有题目列表/);
  });
});