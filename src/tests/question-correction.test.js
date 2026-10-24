import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyCorrections,
  clearCorrection,
  countCorrectionsFor,
  getCorrection,
  saveCorrection,
} from "../question-correction.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const IMAGE = { src: "data:image/png;base64,AAA" };

function baseQuestion() {
  return {
    uid: "bank-1::q1",
    id: "q1",
    bankId: "bank-1",
    bankName: "测试题库",
    type: "single",
    title: "原题干",
    images: [],
    titleImages: [],
    options: [
      { key: "A", content: "选项 A", formulaImages: [IMAGE] },
      { key: "B", content: "选项 B", formulaImages: [] },
    ],
    answer: ["A"],
    answerText: "",
    explanation: "原解析",
  };
}

beforeEach(() => {
  store.clear();
});

describe("本地校正记录", () => {
  it("保存后可以读回，并记录校正时间", () => {
    saveCorrection("bank-1::q1", { title: "改后题干", answer: ["B"] }, baseQuestion());

    const correction = getCorrection("bank-1::q1");
    assert.strictEqual(correction.title, "改后题干");
    assert.deepStrictEqual(correction.answer, ["B"]);
    assert.ok(correction.correctedAt > 0);
    assert.strictEqual(correction.original.title, "原题干");
  });

  it("重复保存时保留最早的 original，便于恢复原题", () => {
    saveCorrection("bank-1::q1", { title: "第一版" }, baseQuestion());
    saveCorrection("bank-1::q1", { title: "第二版" }, { ...baseQuestion(), title: "不应覆盖" });

    const correction = getCorrection("bank-1::q1");
    assert.strictEqual(correction.title, "第二版");
    assert.strictEqual(correction.original.title, "原题干");
  });

  it("清除校正后读不到记录", () => {
    saveCorrection("bank-1::q1", { title: "改后题干" }, baseQuestion());
    clearCorrection("bank-1::q1");
    assert.strictEqual(getCorrection("bank-1::q1"), null);
  });

  it("按题库前缀统计校正数量", () => {
    saveCorrection("bank-1::q1", { title: "a" });
    saveCorrection("bank-1::q2", { title: "b" });
    saveCorrection("bank-2::q1", { title: "c" });

    assert.strictEqual(countCorrectionsFor("bank-1"), 2);
    assert.strictEqual(countCorrectionsFor("bank-2"), 1);
    assert.strictEqual(countCorrectionsFor("bank-3"), 0);
  });
});

describe("把校正叠加回题目", () => {
  it("没有校正时原样返回题目数组", () => {
    const questions = [baseQuestion()];
    assert.strictEqual(applyCorrections(questions), questions);
  });

  it("覆盖题干、答案、解析并标记 corrected", () => {
    saveCorrection("bank-1::q1", {
      title: "改后题干",
      answer: ["B"],
      explanation: "改后解析",
      type: "single",
    });

    const [question] = applyCorrections([baseQuestion()]);
    assert.strictEqual(question.title, "改后题干");
    assert.deepStrictEqual(question.answer, ["B"]);
    assert.strictEqual(question.explanation, "改后解析");
    assert.strictEqual(question.corrected, true);
    assert.strictEqual(question.uid, "bank-1::q1", "题目唯一标识不应被改动");
  });

  it("选项被修改时，按选项标号保留原公式图片", () => {
    saveCorrection("bank-1::q1", {
      options: [
        { key: "A", content: "新选项 A" },
        { key: "B", content: "新选项 B" },
      ],
    });

    const [question] = applyCorrections([baseQuestion()]);
    assert.strictEqual(question.options[0].content, "新选项 A");
    assert.deepStrictEqual(question.options[0].formulaImages, [IMAGE]);
    assert.deepStrictEqual(question.options[1].formulaImages, []);
  });

  it("主观题答案文本可单独覆盖", () => {
    const subjective = {
      ...baseQuestion(),
      uid: "bank-1::q2",
      type: "subjective",
      options: [],
      answer: [],
      answerText: "原参考答案",
    };
    saveCorrection("bank-1::q2", { answerText: "新参考答案", type: "subjective" });

    const [question] = applyCorrections([subjective]);
    assert.strictEqual(question.answerText, "新参考答案");
  });

  it("损坏的本地记录不会导致崩溃", () => {
    store.set("exam-workspace:quiz:corrections", "{not json");
    const questions = [baseQuestion()];
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      assert.strictEqual(applyCorrections(questions), questions);
    } finally {
      console.warn = originalWarn;
    }
  });
});
