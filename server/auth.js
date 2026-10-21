import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { dataDir, db } from "./db.js";

export const ROLES = {
  STUDENT: "student",
  TEACHER: "teacher",
  ADMIN: "admin",
};
export const ROLE_LIST = [ROLES.STUDENT, ROLES.TEACHER, ROLES.ADMIN];
export const ROLE_LABELS = {
  student: "学生",
  teacher: "教师",
  admin: "管理员",
};

const TOKEN_TTL = "7d";

function loadSecret() {
  if (process.env.QUIZ_JWT_SECRET) return process.env.QUIZ_JWT_SECRET;
  const secretPath = join(dataDir, "jwt-secret.txt");
  if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
  // 首次启动生成并落盘，重启后已签发的 token 仍然有效
  const secret = randomBytes(32).toString("hex");
  writeFileSync(secretPath, secret, "utf8");
  return secret;
}

const JWT_SECRET = loadSecret();

export function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(String(password), String(hash));
}

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    createdAt: row.createdAt,
  };
}

export function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function findUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(String(username)) || null;
}

/** 解析并校验 token；每次请求都回读用户，保证管理员改角色后立即生效 */
export function authRequired(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ message: "请先登录" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "登录已失效，请重新登录" });
  }
  const user = findUserById(payload.id);
  if (!user) return res.status(401).json({ message: "账号不存在，请重新登录" });
  req.user = user;
  next();
}

/** 教师与管理员都视为可校对题库的人 */
export function teacherRequired(req, res, next) {
  if (req.user?.role !== ROLES.TEACHER && req.user?.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: "只有教师可以校对题目" });
  }
  next();
}

export function adminRequired(req, res, next) {
  if (req.user?.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: "只有管理员可以修改角色" });
  }
  next();
}
