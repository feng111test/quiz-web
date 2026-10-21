import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, clearDb, loginAs, registerAs } from "./setup.js";

let server;
let baseUrl;

beforeEach(async () => {
  clearDb();
  ({ server, baseUrl } = await startTestServer());
});

afterEach(async () => {
  await stopTestServer(server);
});

describe("身份认证接口", () => {
  it("健康检查应返回 ok", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });

  it("注册新用户成功，返回 token 和公开用户信息（不含密码哈希）", async () => {
    const { status, token, user } = await registerAs(baseUrl, {
      username: "alice",
      password: "Passw0rd!",
      displayName: "Alice",
    });
    assert.strictEqual(status, 201, JSON.stringify({ status, token, user }));
    assert.ok(token, "应返回 token");
    assert.strictEqual(user.username, "alice");
    assert.strictEqual(user.role, "student");
    assert.ok(!user.passwordHash, "公开信息不应包含 passwordHash");
    assert.ok(!user.password, "公开信息不应包含明文密码");
  });

  it("用户名过短应被拒绝", async () => {
    const { status } = await registerAs(baseUrl, {
      username: "ab",
      password: "Passw0rd!",
    });
    assert.strictEqual(status, 400);
  });

  it("用户名含非法字符应被拒绝", async () => {
    const { status } = await registerAs(baseUrl, {
      username: "bad user!",
      password: "Passw0rd!",
    });
    assert.strictEqual(status, 400);
  });

  it("密码少于 6 位应被拒绝", async () => {
    const { status } = await registerAs(baseUrl, {
      username: "bob",
      password: "12345",
    });
    assert.strictEqual(status, 400);
  });

  it("重复用户名注册应返回 409", async () => {
    await registerAs(baseUrl, { username: "carol", password: "Passw0rd!" });
    const { status } = await registerAs(baseUrl, { username: "carol", password: "Passw0rd!" });
    assert.strictEqual(status, 409);
  });

  it("正确登录应返回 token", async () => {
    await registerAs(baseUrl, { username: "dave", password: "Passw0rd!" });
    const { status, token } = await loginAs(baseUrl, "dave", "Passw0rd!");
    assert.strictEqual(status, 200);
    assert.ok(token);
  });

  it("错误密码登录应返回 401", async () => {
    await registerAs(baseUrl, { username: "eve", password: "Passw0rd!" });
    const { status } = await loginAs(baseUrl, "eve", "WrongPass!");
    assert.strictEqual(status, 401);
  });

  it("不存在用户登录也应返回 401（不泄露账号是否存在）", async () => {
    const { status } = await loginAs(baseUrl, "nonexistent", "Passw0rd!");
    assert.strictEqual(status, 401);
  });

  it("缺少用户名或密码登录应返回 400", async () => {
    const res1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "x" }),
    });
    assert.strictEqual(res1.status, 400);
    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "y" }),
    });
    assert.strictEqual(res2.status, 400);
  });

  it("持有有效 token 可访问 /auth/me，无 token 返回 401", async () => {
    await registerAs(baseUrl, { username: "frank", password: "Passw0rd!" });
    const { token } = await loginAs(baseUrl, "frank", "Passw0rd!");

    const okRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(okRes.status, 200);

    const noTokenRes = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(noTokenRes.status, 401);

    const badTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer invalid.token.here" },
    });
    assert.strictEqual(badTokenRes.status, 401);
  });
});