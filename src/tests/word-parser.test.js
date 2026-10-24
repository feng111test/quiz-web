import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionBank } from "../../word-quiz/src/word-parser.js";

const SAMPLE = [
  "一、选择题（每题 3 分）",
  "1．下列说法正确的是（  ）",
  "A．甲",
  "B．乙",
  "C．丙",
  "D．丁",
  "答案：B",
  "【解析】乙正确。",
  "2．下列说法错误的是（  ）",
  "A．甲",
  "B．乙",
  "C．丙",
  "D．丁",
  "答案：B,D",
  "【解析】略。",
  "3．写出实验室制取氧气的化学方程式：",
  "（1）过氧化氢分解：______",
  "（2）高锰酸钾受热：______",
  "答案：（1）2H2O2 = 2H2O + O2↑",
  "（2）2KMnO4 = K2MnO4 + MnO2 + O2↑",
  "【解析】注意反应条件。",
  "4．简述影响化学反应速率的因素。",
  "答案：浓度、温度、压强、催化剂等。",
].join("\n");

test("Word 解析：选择题保留选项与字母答案", () => {
  const { questions } = parseQuestionBank(SAMPLE);
  const single = questions.find((question) => question.number === 1);
  const multiple = questions.find((question) => question.number === 2);

  assert.equal(single.type, "single");
  assert.deepEqual(single.answer, ["B"]);
  assert.equal(single.options.length, 4);
  assert.equal(single.options[0].key, "A");

  assert.equal(multiple.type, "multiple");
  assert.deepEqual(multiple.answer, ["B", "D"]);
});

test("Word 解析：填空/解答题按主观题导入并保留文本答案", () => {
  const { questions, skipped } = parseQuestionBank(SAMPLE);
  assert.deepEqual(skipped, []);

  const fill = questions.find((question) => question.number === 3);
  assert.equal(fill.type, "subjective");
  assert.deepEqual(fill.options, []);
  assert.match(fill.title, /过氧化氢分解/);
  assert.match(fill.answerText, /2H2O2 = 2H2O \+ O2/);
  assert.match(fill.answerText, /2KMnO4 = K2MnO4/);
  assert.equal(fill.explanation, "注意反应条件。");

  const shortAnswer = questions.find((question) => question.number === 4);
  assert.equal(shortAnswer.type, "subjective");
  assert.equal(shortAnswer.answerText, "浓度、温度、压强、催化剂等。");
  assert.match(shortAnswer.title, /影响化学反应速率/);
});

test("Word 解析：没有选项且没有答案的题也不会被丢弃", () => {
  const text = [
    "一、选择题",
    "1．题干（  ）",
    "A．甲",
    "B．乙",
    "答案：A",
    "2．请简述理由。",
    "【解析】本题考查反应速率。",
  ].join("\n");
  const { questions } = parseQuestionBank(text);
  const second = questions.find((question) => question.number === 2);
  assert.equal(second.type, "subjective");
  assert.equal(second.options.length, 0);
  assert.equal(second.answerText, "");
  assert.equal(second.title, "请简述理由。");
  assert.equal(second.explanation, "本题考查反应速率。");
});

test("Word 解析：支持【答案】标记的解答题", () => {
  const text = [
    "一、选择题",
    "1．题干（  ）",
    "A．甲",
    "B．乙",
    "答案：A",
    "2．计算下列物质的量。",
    "【答案】（1）0.5 mol",
    "（2）1 mol",
    "【详解】略。",
  ].join("\n");
  const { questions } = parseQuestionBank(text);
  const second = questions.find((question) => question.number === 2);
  assert.equal(second.type, "subjective");
  assert.match(second.answerText, /0\.5 mol/);
  assert.match(second.answerText, /1 mol/);
  assert.equal(second.explanation, "略。");
});
