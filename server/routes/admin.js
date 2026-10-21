import { Router } from "express";
import { ROLE_LIST, adminRequired, authRequired, publicUser } from "../auth.js";
import { db } from "../db.js";

const router = Router();

router.use(authRequired, adminRequired);

router.get("/users", (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY id ASC").all();
  res.json({ users: rows.map(publicUser).filter(Boolean) });
});

/** 管理员把某个账号提升为教师（或降回学生） */
router.patch("/users/:id/role", (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body?.role ?? "").trim();
  if (!Number.isInteger(id)) return res.status(400).json({ message: "用户编号不合法" });
  if (!ROLE_LIST.includes(role)) return res.status(400).json({ message: "角色不合法" });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ message: "用户不存在" });
  // 至少保留一个管理员，避免把自己锁在外面
  if (user.role === "admin" && role !== "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) return res.status(409).json({ message: "至少保留一个管理员" });
  }

  db.prepare("UPDATE users SET role = ?, updatedAt = ? WHERE id = ?").run(role, Date.now(), id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  res.json({ user: publicUser(updated) });
});

export default router;
