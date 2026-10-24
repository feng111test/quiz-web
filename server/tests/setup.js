/**
 * 测试辅助：创建一个与生产相同中间件/路由的 Express 应用，
 * 监听随机端口，并在测试之间清空数据库表。
 * 不会启动 npm run server 的主进程，避免种子账号和 0.0.0.0 监听。
 */
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Router } from "express";
import authRoutes from "../routes/auth.js";
import adminRoutes from "../routes/admin.js";
import correctionRoutes from "../routes/corrections.js";
import feedbackRoutes from "../routes/feedback.js";
import { hashPassword } from "../auth.js";
import { db } from "../db.js";

const TABLES = ["users", "corrections", "feedback"];

/** 清空所有业务表，保持表结构 */
export function clearDb() {
  for (const table of TABLES) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  // 重置 AUTOINCREMENT 序列，便于断言 id
  try {
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('users','corrections','feedback')`).run();
  } catch { /* sqlite_sequence 表可能不存在，忽略 */ }
}

/** 创建测试用 Express 应用（不监听端口） */
export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "quiz-server" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/corrections", correctionRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/admin", adminRoutes);
  return app;
}

/** 启动测试服务器，返回 { app, server, port, baseUrl } */
export async function startTestServer() {
  const app = createTestApp();
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { app, server, port, baseUrl: `http://127.0.0.1:${port}` };
}

/** 停止测试服务器 */
export function stopTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** 登录并返回 token */
export async function loginAs(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  return { status: res.status, token: data.token, user: data.user };
}

/**
 * 直接写入指定角色的账号。
 * 注册接口只会创建学生（防止注册时自选角色提权），
 * 因此测试里的教师/管理员必须绕过接口、直接落库。
 */
export async function createUserWithRole({ username, password, displayName, role }) {
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  const info = db
    .prepare(
      `INSERT INTO users (username, displayName, passwordHash, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(username, displayName || username, passwordHash, role, now, now);
  return Number(info.lastInsertRowid);
}

/** 注册并返回 token */
export async function registerAs(baseUrl, { username, password, displayName }) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, displayName }),
  });
  const data = await res.json();
  return { status: res.status, token: data.token, user: data.user };
}

/** 带 token 请求的封装 */
export async function authedFetch(baseUrl, token, path, opts = {}) {
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}