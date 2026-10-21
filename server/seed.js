import { db } from "./db.js";
import { ROLES, hashPassword } from "./auth.js";

/**
 * 预置账号。学生可以自行注册，教师/管理员只能由预置账号或管理员提升，
 * 避免注册时自选角色导致权限形同虚设。
 * 需要改默认密码请设置环境变量：QUIZ_SEED_ADMIN_PASSWORD / QUIZ_SEED_TEACHER_PASSWORD / QUIZ_SEED_STUDENT_PASSWORD
 */
const SEED_USERS = [
  { username: "admin", displayName: "系统管理员", role: ROLES.ADMIN, password: "admin123" },
  { username: "teacher", displayName: "化学教师", role: ROLES.TEACHER, password: "teacher123" },
  { username: "student", displayName: "示例学生", role: ROLES.STUDENT, password: "student123" },
];

function passwordOf(user) {
  const key = `QUIZ_SEED_${user.role.toUpperCase()}_PASSWORD`;
  return process.env[key] || user.password;
}

export async function seedUsers() {
  const insert = db.prepare(
    `INSERT INTO users (username, displayName, passwordHash, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const created = [];
  for (const user of SEED_USERS) {
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(user.username);
    if (exists) continue;
    const now = Date.now();
    const hash = await hashPassword(passwordOf(user));
    const result = insert.run(user.username, user.displayName, hash, user.role, now, now);
    created.push({ username: user.username, role: user.role, password: passwordOf(user) });
    void result;
  }
  return created;
}

export { SEED_USERS };
