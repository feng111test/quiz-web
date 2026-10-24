import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// 固定 JWT 密钥，便于构造“过期 / 伪造签名”的 token。
// 必须在导入 setup.js（进而导入 auth.js）之前设置，否则 auth.js 会读取落盘密钥。
const TEST_SECRET = "unit-test-secret-do-not-use-in-production-0123456789";
process.env.QUIZ_JWT_SECRET = TEST_SECRET;

const {
  startTestServer,
  stopTestServer,
  clearDb,
  registerAs,
  createUserWithRole,
  loginAs,
  authedFetch,
} = await import("./setup.js");
const { db } = await import("../db.js");
const jwt = (await import("jsonwebtoken")).default;

let server;
let baseUrl;
let adminId;
let adminToken;

beforeEach(async () => {
  clearDb();
  ({ server, baseUrl } = await startTestServer());

  adminId = await createUserWithRole({
    username: "h_admin",
    password: "Passw0rd!",
    displayName: "安全管理员",
    role: "admin",
  });
  adminToken = (await loginAs(baseUrl, "h_admin", "Passw0rd!")).token;
});

afterEach(async () => {
  await stopTestServer(server);
});

describe("JWT 安全", () => {
  it("签名被篡改的 token 应被拒绝", async () => {
    const { user } = await registerAs(baseUrl, {
      username: "h_forged",
      password: "Passw0rd!",
    });
    const forged = jwt.sign({ id: user.id, username: user.username }, "wrong-secret", {
      expiresIn: "1h",
    });
    const { status } = await authedFetch(baseUrl, forged, "/api/auth/me");
    assert.strictEqual(status, 401);
  });

  it("已过期的 token 应被拒绝", async () => {
    const { user } = await registerAs(baseUrl, {
      username: "h_expired",
      password: "Passw0rd!",
    });
    // expiresIn 为负数：签发即过期
    const expired = jwt.sign({ id: user.id, username: user.username }, TEST_SECRET, {
      expiresIn: -10,
    });
    const { status } = await authedFetch(baseUrl, expired, "/api/auth/me");
    assert.strictEqual(status, 401);
  });

  it("账号被删除后，旧 token 立即失效", async () => {
    const { user } = await registerAs(baseUrl, {
      username: "h_deleted",
      password: "Passw0rd!",
    });
    const { token } = await loginAs(baseUrl, "h_deleted", "Passw0rd!");
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    const { status } = await authedFetch(baseUrl, token, "/api/auth/me");
    assert.strictEqual(status, 401);
  });

  it("畸形 Authorization 头应返回 401", async () => {
    for (const header of ["Bearer", "Basic abc", "Token abc", "Bearer   "]) {
      const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: header } });
      assert.strictEqual(res.status, 401, `Authorization: ${header} 应被拒绝`);
    }
  });

  it("角色变更后旧 token 的权限立即生效（无需重新登录）", async () => {
    const { user } = await registerAs(baseUrl, {
      username: "h_role",
      password: "Passw0rd!",
    });
    const { token } = await loginAs(baseUrl, "h_role", "Passw0rd!");
    const payload = {
      bankId: "bank-1",
      questionId: "q-role",
      type: "single",
      title: "角色测试题干",
      options: [
        { key: "A", content: "A" },
        { key: "B", content: "B" },
      ],
      answer: ["A"],
    };

    // 学生：403
    assert.strictEqual(
      (await authedFetch(baseUrl, token, "/api/corrections", { method: "PUT", body: payload })).status,
      403,
    );

    // 提升为教师后，同一个 token 立即拥有校对权限
    const promote = await authedFetch(baseUrl, adminToken, `/api/admin/users/${user.id}/role`, {
      method: "PATCH",
      body: { role: "teacher" },
    });
    assert.strictEqual(promote.status, 200);
    assert.strictEqual(
      (await authedFetch(baseUrl, token, "/api/corrections", { method: "PUT", body: payload })).status,
      200,
    );

    // 降回学生后立即失去权限
    const demote = await authedFetch(baseUrl, adminToken, `/api/admin/users/${user.id}/role`, {
      method: "PATCH",
      body: { role: "student" },
    });
    assert.strictEqual(demote.status, 200);
    assert.strictEqual(
      (await authedFetch(baseUrl, token, "/api/corrections", { method: "PUT", body: payload })).status,
      403,
    );
  });
});

describe("权限提升与敏感信息", () => {
  it("注册接口不能自选管理员/教师角色", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "h_escalate",
        password: "Passw0rd!",
        role: "admin",
      }),
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.user.role, "student", "注册时传入的 role 必须被忽略");

    // 用该账号访问管理员接口仍应 403
    const denied = await authedFetch(baseUrl, data.token, "/api/admin/users");
    assert.strictEqual(denied.status, 403);
  });

  it("管理员用户列表不应返回密码哈希", async () => {
    await registerAs(baseUrl, { username: "h_list", password: "Passw0rd!" });
    const { status, data } = await authedFetch(baseUrl, adminToken, "/api/admin/users");
    assert.strictEqual(status, 200);
    for (const user of data.users) {
      assert.ok(!("passwordHash" in user), "用户列表不应包含 passwordHash");
      assert.ok(!("password" in user), "用户列表不应包含明文密码");
    }
  });

  it("校对记录响应不应泄露 authorId 等内部字段", async () => {
    await createUserWithRole({
      username: "h_teacher",
      password: "Passw0rd!",
      displayName: "安全教师",
      role: "teacher",
    });
    const { token } = await loginAs(baseUrl, "h_teacher", "Passw0rd!");
    const { status, data } = await authedFetch(baseUrl, token, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-sec",
        questionId: "q-sec",
        type: "single",
        title: "安全题干",
        options: [
          { key: "A", content: "A" },
          { key: "B", content: "B" },
        ],
        answer: ["A"],
        explanation: "解析",
      },
    });
    assert.strictEqual(status, 200);
    assert.ok(!("authorId" in data.correction), "响应不应暴露 authorId");
    assert.strictEqual(data.correction.authorName, "安全教师");

    // 公开读取接口同样不泄露内部字段
    const list = await fetch(`${baseUrl}/api/corrections?bankId=bank-sec`).then((res) => res.json());
    assert.ok(!("authorId" in list.corrections[0]));
  });

  it("反馈处理的非法编号与不存在记录应分别返回 400 / 404", async () => {
    const { token: teacherToken } = await loginAs(baseUrl, "h_admin", "Passw0rd!");
    const bad = await authedFetch(baseUrl, teacherToken, "/api/feedback/abc/resolve", {
      method: "POST",
      body: { action: "accept" },
    });
    assert.strictEqual(bad.status, 400);

    const missing = await authedFetch(baseUrl, teacherToken, "/api/feedback/999999/resolve", {
      method: "POST",
      body: { action: "accept" },
    });
    assert.strictEqual(missing.status, 404);
  });
});
