import { Router } from "express";
import { authRequired, teacherRequired } from "../auth.js";
import { db } from "../db.js";
import { FEEDBACK_REASONS, FEEDBACK_STATUS } from "../question-fields.js";

const router = Router();

function parseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    questionId: row.questionId,
    questionTitle: row.questionTitle,
    bankName: row.bankName,
    reason: row.reason,
    suggestion: row.suggestion,
    status: row.status,
    authorName: row.authorName,
    handlerName: row.handlerName,
    handleNote: row.handleNote,
    createdAt: row.createdAt,
    handledAt: row.handledAt,
  };
}

/** 学生提交反馈 */
router.post("/", authRequired, (req, res) => {
  const bankId = String(req.body?.bankId ?? "").trim();
  const questionId = String(req.body?.questionId ?? "").trim();
  const suggestion = String(req.body?.suggestion ?? "").trim();
  const reason = String(req.body?.reason ?? "").trim();

  if (!bankId || !questionId) return res.status(400).json({ message: "缺少题目标识" });
  if (!suggestion) return res.status(400).json({ message: "请填写反馈内容" });
  if (reason && !FEEDBACK_REASONS.includes(reason)) {
    return res.status(400).json({ message: "反馈类型不合法" });
  }

  const result = db
    .prepare(
      `INSERT INTO feedback
         (bankId, questionId, questionTitle, bankName, reason, suggestion, status,
          authorId, authorName, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      bankId,
      questionId,
      String(req.body?.questionTitle ?? "").trim().slice(0, 500),
      String(req.body?.bankName ?? "").trim().slice(0, 200),
      reason || "其他",
      suggestion.slice(0, 4000),
      FEEDBACK_STATUS.OPEN,
      req.user.id,
      req.user.displayName || req.user.username,
      Date.now(),
    );

  const row = db.prepare("SELECT * FROM feedback WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ feedback: parseRow(row) });
});

/** 学生看自己的反馈，教师看全部 */
router.get("/mine", authRequired, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM feedback WHERE authorId = ? ORDER BY createdAt DESC LIMIT 100")
    .all(req.user.id);
  res.json({ feedback: rows.map(parseRow).filter(Boolean) });
});

/** 教师处理列表 */
router.get("/", authRequired, teacherRequired, (req, res) => {
  const status = String(req.query.status ?? FEEDBACK_STATUS.OPEN).trim();
  const where = status && status !== "all" ? "WHERE status = ?" : "";
  const args = where ? [status] : [];
  const rows = db
    .prepare(`SELECT * FROM feedback ${where} ORDER BY createdAt DESC LIMIT 200`)
    .all(...args);
  res.json({ feedback: rows.map(parseRow).filter(Boolean) });
});

/** 教师处理：采纳（可顺带写入校正）或驳回 */
router.post("/:id/resolve", authRequired, teacherRequired, (req, res) => {
  const id = Number(req.params.id);
  const action = String(req.body?.action ?? "").trim();
  const note = String(req.body?.note ?? "").trim();
  if (!Number.isInteger(id)) return res.status(400).json({ message: "反馈编号不合法" });
  if (action !== "accept" && action !== "reject") {
    return res.status(400).json({ message: "处理动作不合法" });
  }

  const row = db.prepare("SELECT * FROM feedback WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ message: "反馈不存在" });
  if (row.status !== FEEDBACK_STATUS.OPEN) {
    return res.status(409).json({ message: "该反馈已处理过了" });
  }

  db.prepare(
    `UPDATE feedback
       SET status = ?, handlerId = ?, handlerName = ?, handleNote = ?, handledAt = ?
     WHERE id = ?`,
  ).run(
    action === "accept" ? FEEDBACK_STATUS.ACCEPTED : FEEDBACK_STATUS.REJECTED,
    req.user.id,
    req.user.displayName || req.user.username,
    note,
    Date.now(),
    id,
  );

  const updated = db.prepare("SELECT * FROM feedback WHERE id = ?").get(id);
  res.json({ feedback: parseRow(updated) });
});

export default router;
