import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db.js";
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

async function createTeacherUser() {
  const { hashPassword } = await import("../auth.js");
  const now = Date.now();
  const passwordHash = await hashPassword("Passw0rd!");
  db.prepare(
    `INSERT INTO users (username, displayName, passwordHash, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("fb_teacher", "反馈教师", passwordHash, "teacher", now, now);
}

beforeEach(async () => {
  clearDb();
  ({ server, baseUrl } = await startTestServer());

  await createTeacherUser();
  const t = await loginAs(baseUrl, "fb_teacher", "Passw0rd!");
  teacherToken = t.token;

  await registerAs(baseUrl, {
    username: "fb_student",
    password: "Passw0rd!",
    displayName: "反馈学生",
  });
  const s = await loginAs(baseUrl, "fb_student", "Passw0rd!");
  studentToken = s.token;
});

afterEach(async () => {
  await stopTestServer(server);
});

describe("学生反馈接口", () => {
  it("学生提交反馈成功，返回 201 和记录", async () => {
    const { status, data } = await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        questionTitle: "题目标题",
        bankName: "试卷名",
        reason: "答案有误",
        suggestion: "建议将答案改为 B",
      },
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(data.feedback.bankId, "bank-1");
    assert.strictEqual(data.feedback.status, "open");
    assert.strictEqual(data.feedback.authorName, "反馈学生");
  });

  it("缺少建议内容应返回 400", async () => {
    const { status } = await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: { bankId: "bank-1", questionId: "q1", suggestion: "" },
    });
    assert.strictEqual(status, 400);
  });

  it("非法反馈类型应返回 400", async () => {
    const { status } = await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        suggestion: "内容",
        reason: "不存在的类型",
      },
    });
    assert.strictEqual(status, 400);
  });

  it("学生只能查看自己的反馈（/mine）", async () => {
    await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        suggestion: "学生反馈",
      },
    });
    const { status, data } = await authedFetch(baseUrl, studentToken, "/api/feedback/mine");
    assert.strictEqual(status, 200);
    assert.ok(data.feedback.length >= 1);
    data.feedback.forEach((f) => {
      assert.strictEqual(f.authorName, "反馈学生");
    });
  });

  it("学生不能查看教师反馈列表（GET / 需要教师权限）", async () => {
    const { status } = await authedFetch(baseUrl, studentToken, "/api/feedback");
    assert.strictEqual(status, 403);
  });

  it("教师可以查看所有反馈列表", async () => {
    await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: { bankId: "bank-1", questionId: "q1", suggestion: "内容" },
    });
    const { status, data } = await authedFetch(baseUrl, teacherToken, "/api/feedback");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data.feedback));
  });

  it("教师可以采纳或驳回反馈，已处理的反馈不能重复处理", async () => {
    const { data } = await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: { bankId: "bank-1", questionId: "q1", suggestion: "内容" },
    });
    const id = data.feedback.id;

    const acceptRes = await authedFetch(baseUrl, teacherToken, `/api/feedback/${id}/resolve`, {
      method: "POST",
      body: { action: "accept", note: "已处理" },
    });
    assert.strictEqual(acceptRes.status, 200);
    assert.strictEqual(acceptRes.data.feedback.status, "accepted");

    const repeatRes = await authedFetch(baseUrl, teacherToken, `/api/feedback/${id}/resolve`, {
      method: "POST",
      body: { action: "reject", note: "重复处理" },
    });
    assert.strictEqual(repeatRes.status, 409);
  });

  it("非法处理动作应返回 400", async () => {
    const { data } = await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: { bankId: "bank-1", questionId: "q1", suggestion: "内容" },
    });
    const id = data.feedback.id;
    const { status } = await authedFetch(baseUrl, teacherToken, `/api/feedback/${id}/resolve`, {
      method: "POST",
      body: { action: "invalid", note: "" },
    });
    assert.strictEqual(status, 400);
  });
});