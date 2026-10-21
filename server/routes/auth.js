import { Router } from "express";
import {
  ROLES,
  authRequired,
  findUserById,
  findUserByUsername,
  hashPassword,
  publicUser,
  signToken,
  verifyPassword,
} from "../auth.js";
import { db } from "../db.js";

const router = Router();

function readCredentials(body) {
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  return { username, password };
}

router.post("/register", async (req, res) => {
  const { username, password } = readCredentials(req.body);
  const displayName = String(req.body?.displayName ?? "").trim() || username;

  if (!/^[\w一-龥.-]{3,32}$/.test(username)) {
    return res.status(400).json({ message: "用户名需为 3~32 位字母、数字、下划线或中文" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "密码至少 6 位" });
  }
  if (findUserByUsername(username)) {
    return res.status(409).json({ message: "该用户名已被注册" });
  }

  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO users (username, displayName, passwordHash, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(username, displayName, await hashPassword(password), ROLES.STUDENT, now, now);

  const user = findUserById(result.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { username, password } = readCredentials(req.body);
  if (!username || !password) {
    return res.status(400).json({ message: "请输入用户名和密码" });
  }
  const user = findUserByUsername(username);
  // 用户名不存在时也走一次哈希比对，避免响应时间泄露账号是否存在
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi");
  if (!user || !ok) {
    return res.status(401).json({ message: "用户名或密码不正确" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
