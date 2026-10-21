import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  stopTestServer,
  clearDb,
  registerAs,
  loginAs,
  authedFetch,
} from "./setup.js";

let server;
let baseUrl;
let teacherToken;
let studentToken;

beforeEach(async () => {
  clearDb();
  ({ server, baseUrl } = await startTestServer());

  await registerAs(baseUrl, {
    username: "t_teacher",
    password: "Passw0rd!",
    displayName: "教师",
  });
  const t = await loginAs(baseUrl, "t_teacher", "Passw0rd!");
  teacherToken = t.token;

  await registerAs(baseUrl, {
    username: "s_student",
    password: "Passw0rd!",
    displayName: "学生",
  });
  const s = await loginAs(baseUrl, "s_student", "Passw0rd!");
  studentToken = s.token;
});

afterEach(async () => {
  await stopTestServer(server);
});

describe("题目校对接口", () => {
  it("未登录（无 token）学生也能读取校正列表（GET 公开）", async () => {
    const res = await fetch(`${baseUrl}/api/corrections?bankId=bank-1`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.corrections));
  });

  it("缺少 bankId 返回 400", async () => {
    const res = await fetch(`${baseUrl}/api/corrections`);
    assert.strictEqual(res.status, 400);
  });

  it("学生调用 PUT 校对接口应返回 403（权限不足）", async () => {
    const { status } = await authedFetch(baseUrl, studentToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        type: "single",
        title: "测试题干",
        options: [{ key: "A", content: "选项 A" }, { key: "B", content: "选项 B" }],
        answer: ["A"],
      },
    });
    assert.strictEqual(status, 403);
  });

  it("教师成功保存校正内容，返回校正记录", async () => {
    const { status, data } = await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        type: "single",
        title: "校正后的题干",
        options: [{ key: "A", content: "选项 A" }, { key: "B", content: "选项 B" }],
        answer: ["A"],
        answerText: "",
        explanation: "解析内容",
      },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.correction.bankId, "bank-1");
    assert.strictEqual(data.correction.questionId, "q1");
    assert.strictEqual(data.correction.title, "校正后的题干");
    assert.strictEqual(data.correction.authorName, "教师");
  });

  it("客观题选项少于 2 个应返回 400", async () => {
    const { status } = await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q2",
        type: "single",
        title: "题干",
        options: [{ key: "A", content: "只有一个选项" }],
        answer: ["A"],
      },
    });
    assert.strictEqual(status, 400);
  });

  it("客观题未选答案应返回 400", async () => {
    const { status } = await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q3",
        type: "single",
        title: "题干",
        options: [{ key: "A", content: "A" }, { key: "B", content: "B" }],
        answer: [],
      },
    });
    assert.strictEqual(status, 400);
  });

  it("主观题缺少参考答案应返回 400", async () => {
    const { status } = await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q4",
        type: "subjective",
        title: "简答题",
        answerText: "",
      },
    });
    assert.strictEqual(status, 400);
  });

  it("非法题型应返回 400", async () => {
    const { status } = await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q5",
        type: "invalid-type",
        title: "题干",
        answerText: "x",
      },
    });
    assert.strictEqual(status, 400);
  });

  it("教师可以删除自己的校正记录", async () => {
    await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q-del",
        type: "single",
        title: "将被删除",
        options: [{ key: "A", content: "A" }, { key: "B", content: "B" }],
        answer: ["A"],
      },
    });
    const { status } = await authedFetch(baseUrl, teacherToken, "/api/corrections", {
      method: "DELETE",
      body: { bankId: "bank-1", questionId: "q-del" },
    });
    assert.strictEqual(status, 200);
  });
});