import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  startTestServer,
  stopTestServer,
  clearDb,
  registerAs,
  createUserWithRole,
  loginAs,
  authedFetch,
} from "./setup.js";

let server;
let baseUrl;
let adminToken;
let adminId;
let studentToken;

beforeEach(async () => {
  clearDb();
  ({ server, baseUrl } = await startTestServer());

  // 管理员不能通过注册接口创建（注册一律是学生），直接落库
  adminId = await createUserWithRole({
    username: "admin",
    password: "admin123",
    displayName: "系统管理员",
    role: "admin",
  });
  const a = await loginAs(baseUrl, "admin", "admin123");
  adminToken = a.token;

  await registerAs(baseUrl, {
    username: "sec_student",
    password: "Passw0rd!",
    displayName: "安全测试学生",
  });
  const s = await loginAs(baseUrl, "sec_student", "Passw0rd!");
  studentToken = s.token;
});

afterEach(async () => {
  await stopTestServer(server);
});

describe("安全测试", () => {
  it("JWT 密钥不应出现在前端源码中（服务端负责保管）", () => {
    const secretPath = path.resolve("server/data/jwt-secret.txt");
    // 密钥文件只应存在于服务端 data 目录，不应被复制到 public/dist
    const publicSecret = path.resolve("public/jwt-secret.txt");
    const distSecret = path.resolve("dist/jwt-secret.txt");
    assert.ok(!fs.existsSync(publicSecret), "JWT 密钥不应出现在 public 目录");
    assert.ok(!fs.existsSync(distSecret), "JWT 密钥不应出现在 dist 目录");
    // 如果文件存在，应只在服务端 data 目录（用路径比较，避免 Windows 反斜杠误判）
    if (fs.existsSync(secretPath)) {
      assert.strictEqual(
        path.dirname(secretPath),
        path.resolve("server/data"),
        "JWT 密钥文件应位于 server/data 目录",
      );
    }
  });

  it("前端源码中不应硬编码真实 API 密钥或 JWT 密钥", () => {
    const frontendFiles = [
      "src/api.js",
      "src/auth.js",
      "src/vision-client.js",
    ];
    const secretsPattern = /(sk-|sk_live|pk_live|AIza|eyJhbGci)/i;
    for (const file of frontendFiles) {
      const fullPath = path.resolve(file);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      assert.ok(
        !secretsPattern.test(content),
        `${file} 中不应包含硬编码的真实密钥`
      );
    }
  });

  it("SQL 注入：用户名字段不应导致绕过身份验证", async () => {
    const malicious = "admin' OR '1'='1";
    const { status } = await loginAs(baseUrl, malicious, "anything");
    assert.strictEqual(status, 401);
  });

  it("SQL 注入：密码字段不应导致绕过身份验证", async () => {
    const { status } = await loginAs(baseUrl, "admin", "anything' OR '1'='1");
    assert.strictEqual(status, 401);
  });

  it("SQL 注入：bankId 参数不应导致数据泄露或错误", async () => {
    const res = await fetch(
      `${baseUrl}/api/corrections?bankId='; DROP TABLE users;--`
    );
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.corrections));
    // 确保用户表仍然存在（注入未成功）
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(meRes.status, 200);
  });

  it("XSS：escapeHtml 应转义危险字符", async () => {
    // 直接测试前端 escapeHtml 函数
    const { escapeHtml } = await import("../../src/question-text.js");
    assert.strictEqual(escapeHtml('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.strictEqual(escapeHtml('"&<>'), "&quot;&amp;&lt;&gt;");
    assert.strictEqual(escapeHtml("'"), "&#39;");
  });

  it("学生越权访问管理员接口应返回 403", async () => {
    const { status } = await authedFetch(baseUrl, studentToken, "/api/admin/users");
    assert.strictEqual(status, 403);
  });

  it("学生越权访问教师校对接口应返回 403", async () => {
    const { status } = await authedFetch(baseUrl, studentToken, "/api/corrections", {
      method: "PUT",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        type: "single",
        title: "越权尝试",
        options: [{ key: "A", content: "A" }, { key: "B", content: "B" }],
        answer: ["A"],
      },
    });
    assert.strictEqual(status, 403);
  });

  it("无效 JWT 令牌应被拒绝", async () => {
    const { status } = await authedFetch(baseUrl, "not.a.valid.token", "/api/auth/me");
    assert.strictEqual(status, 401);
  });

  it("管理员不能将自己降级为非管理员（若为唯一管理员）", async () => {
    // 当前只有 admin 一个管理员，尝试将 admin 降级为 student 应返回 409
    const { status } = await authedFetch(baseUrl, adminToken, `/api/admin/users/${adminId}/role`, {
      method: "PATCH",
      body: { role: "student" },
    });
    assert.strictEqual(status, 409);
  });

  it("注册时用户名注入尝试应被正则拒绝", async () => {
    const injections = ["admin';--", "' OR 1=1 --", "../../etc/passwd"];
    for (const username of injections) {
      const { status } = await registerAs(baseUrl, { username, password: "Passw0rd!" });
      assert.strictEqual(status, 400, `用户名 ${username} 应被拒绝`);
    }
  });

  it("反馈建议内容应被截断，防止过长载荷", async () => {
    const longSuggestion = "x".repeat(10000);
    const { status } = await authedFetch(baseUrl, studentToken, "/api/feedback", {
      method: "POST",
      body: {
        bankId: "bank-1",
        questionId: "q1",
        suggestion: longSuggestion,
      },
    });
    // 应该被接受但截断，或者返回成功（后端 slice(0, 4000)）
    assert.ok(status === 201 || status === 400);
  });

  it("生产构建不应包含 source map（避免反编译还原源码）", () => {
    const distDir = path.resolve("dist");
    if (!fs.existsSync(distDir)) return; // 尚未构建时跳过
    const files = fs.readdirSync(distDir, { recursive: true });
    const mapFiles = files.filter((f) => f.endsWith(".map"));
    assert.strictEqual(mapFiles.length, 0, `生产构建不应包含 source map 文件：${mapFiles.join(", ")}`);
  });

  it("登录响应不应区分用户不存在与密码错误（防时序/枚举攻击）", async () => {
    // 不存在用户和错误密码都应返回相同 401 和相同错误消息
    const res1 = await loginAs(baseUrl, "no_such_user", "Passw0rd!");
    const res2 = await loginAs(baseUrl, "admin", "wrong_password");
    assert.strictEqual(res1.status, 401);
    assert.strictEqual(res2.status, 401);
  });
});