import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseQuestionsFromText } from "../question-parser.js";

describe("题目文本解析（question-parser）", () => {
  it("解析单选题：标准格式 1. 题干 A. 选项 B. 选项 答案：A", () => {
    const text = `1. 下列哪种物质是氧化物？（）
A. O2
B. H2O
C. H2O2
D. O3
答案：B`;
    const questions = parseQuestionsFromText(text);
    assert.strictEqual(questions.length, 1);
    assert.strictEqual(questions[0].type, "single");
    assert.ok(questions[0].title.includes("氧化物"));
    assert.strictEqual(questions[0].answer, "B");
    assert.strictEqual(questions[0].options.length, 4);
  });

  it("解析多选题：答案包含多个字母，type 应为 multiple", () => {
    const text = `1. 下列属于混合物的是（ ）
A. 氧气
B. 空气
C. 合金
D. 纯水
答案：B,C`;
    const questions = parseQuestionsFromText(text);
    assert.strictEqual(questions.length, 1);
    assert.strictEqual(questions[0].type, "multiple");
    assert.strictEqual(questions[0].answer, "B,C");
  });

  it("解析判断题：正确/错误", () => {
    const text = `1. 水的化学式是 H2O。（正确）
答案：正确`;
    const questions = parseQuestionsFromText(text);
    assert.strictEqual(questions.length, 1);
    assert.strictEqual(questions[0].type, "judge");
    assert.strictEqual(questions[0].answer, "正确");
  });

  it("忽略页眉页脚行", () => {
    const text = `第 1 页 共 5 页
1. 试题内容？
A. 选项 A
B. 选项 B
答案：A
第 2 页`;
    const questions = parseQuestionsFromText(text);
    assert.strictEqual(questions.length, 1);
    assert.strictEqual(questions[0].answer, "A");
  });

  it("答案与选项同一行时不丢失选项", () => {
    const text = `1. 试题内容？
A. 选项 A 【答案】A
B. 选项 B`;
    const questions = parseQuestionsFromText(text);
    assert.strictEqual(questions.length, 1);
    assert.ok(questions[0].title.includes("试题内容"), "题干应保留");
    assert.strictEqual(questions[0].answer, "A");
  });

  it("空输入返回空数组", () => {
    assert.deepStrictEqual(parseQuestionsFromText(""), []);
    assert.deepStrictEqual(parseQuestionsFromText("\n\n"), []);
  });

  it("无答案且无选项的题干应被过滤", () => {
    const text = `这只是一段没有答案的题干，没有选项`;
    assert.deepStrictEqual(parseQuestionsFromText(text), []);
  });

  it("判断题答案使用 √/× 应被正确识别", () => {
    const text = `1. 试题内容？（正确）
答案：√`;
    const questions = parseQuestionsFromText(text);
    assert.strictEqual(questions[0].answer, "正确");
  });
});