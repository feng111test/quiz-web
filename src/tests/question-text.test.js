import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formulaCount, renderFormulaContent } from "../question-text.js";

describe("question-text 工具函数", () => {
  it("escapeHtml 转义 HTML 特殊字符，防 XSS", () => {
    assert.strictEqual(escapeHtml("<script>alert('xss')</script>"), "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    assert.strictEqual(escapeHtml('"&<>\''), "&quot;&amp;&lt;&gt;&#39;");
    assert.strictEqual(escapeHtml(""), "");
    assert.strictEqual(escapeHtml(null), "");
    assert.strictEqual(escapeHtml(undefined), "");
  });

  it("formulaCount 统计公式占位符数量", () => {
    const TOKEN = "\uE000";
    assert.strictEqual(formulaCount(""), 0);
    assert.strictEqual(formulaCount("无公式"), 0);
    assert.strictEqual(formulaCount(`${TOKEN}`), 1);
    assert.strictEqual(formulaCount(`a${TOKEN}b${TOKEN}c`), 2);
  });

  it("renderFormulaContent 将公式占位符替换为 img 标签，其余转义", () => {
    const TOKEN = "\uE000";
    const images = [{ src: "data:image/png;base64,abc" }];
    const result = renderFormulaContent(`H${TOKEN}O`, images);
    assert.ok(result.includes('<img class="formula-image formula-inline" src="data:image/png;base64,abc" alt="原文公式">'));
    assert.ok(result.includes("H"));
    assert.ok(result.includes("O"));
  });

  it("renderFormulaContent 缺少图片时显示 fallback", () => {
    const TOKEN = "\uE000";
    const result = renderFormulaContent(`H${TOKEN}O`, []);
    assert.ok(result.includes("原文公式图片未能匹配"));
  });
});