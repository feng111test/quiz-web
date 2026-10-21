import { Router } from "express";
import { authRequired, teacherRequired } from "../auth.js";
import { db } from "../db.js";
import { QUESTION_TYPES } from "../question-fields.js";

const router = Router();

const ALLOWED_TYPES = QUESTION_TYPES;

function readOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => ({
      key: String(option?.key ?? "").trim(),
      content: String(option?.content ?? option?.text ?? "").trim(),
      formulaImages: Array.isArray(option?.formulaImages)
        ? option.formulaImages
            .map((image) => ({ src: String(image?.src ?? image?.dataUrl ?? "") }))
            .filter((image) => image.src.startsWith("data:"))
        : [],
    }))
    .filter((option) => option.key && option.content);
}

function readImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((image) => ({ src: String(image?.src ?? image?.dataUrl ?? "") }))
    .filter((image) => image.src.startsWith("data:image/"));
}

function readAnswer(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\s]+/);
  return [...new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function parseRow(row) {
  if (!row) return null;
  let options = [];
  let answer = [];
  let images = [];
  let titleImages = [];
  try {
    options = JSON.parse(row.options || "[]");
  } catch {
    options = [];
  }
  try {
    answer = JSON.parse(row.answer || "[]");
  } catch {
    answer = [];
  }
  try { images = JSON.parse(row.images || "[]"); } catch { images = []; }
  try { titleImages = JSON.parse(row.titleImages || "[]"); } catch { titleImages = []; }
  if (!Array.isArray(options)) options = [];
  if (!Array.isArray(answer)) answer = [];
  return {
    bankId: row.bankId,
    questionId: row.questionId,
    type: row.type,
    title: row.title,
    answerText: row.answerText || "",
    options,
    answer,
    explanation: row.explanation || "",
    images: row.images == null ? undefined : readImages(images),
    titleImages: row.titleImages == null ? undefined : readImages(titleImages),
    authorName: row.authorName || "",
    updatedAt: row.updatedAt,
  };
}

/** 校对后的题目内容对所有人生效：未登录也能读到 */
router.get("/", (req, res) => {
  const bankId = String(req.query.bankId ?? "").trim();
  if (!bankId) return res.status(400).json({ message: "缺少 bankId" });
  const rows = db
    .prepare("SELECT * FROM corrections WHERE bankId = ? ORDER BY updatedAt DESC")
    .all(bankId);
  res.json({ corrections: rows.map(parseRow).filter(Boolean) });
});

/** 教师校对：直接改写后端题库中这道题的内容 */
router.put("/", authRequired, teacherRequired, (req, res) => {
  const bankId = String(req.body?.bankId ?? "").trim();
  const questionId = String(req.body?.questionId ?? "").trim();
  const type = String(req.body?.type ?? "").trim();
  const title = String(req.body?.title ?? "").trim();

  if (!bankId || !questionId) return res.status(400).json({ message: "缺少题目标识" });
  if (!ALLOWED_TYPES.includes(type)) return res.status(400).json({ message: "题型不合法" });
  if (!title) return res.status(400).json({ message: "题干不能为空" });

  const options = readOptions(req.body?.options);
  const answer = readAnswer(req.body?.answer);
  const answerText = String(req.body?.answerText ?? "").trim();
  const images = readImages(req.body?.images);
  const titleImages = readImages(req.body?.titleImages);

  if (type === "subjective") {
    if (!answerText) return res.status(400).json({ message: "主观题请填写参考答案" });
  } else {
    if (options.length < 2) return res.status(400).json({ message: "客观题至少保留两个选项" });
    if (!answer.length) return res.status(400).json({ message: "请勾选正确答案" });
  }

  db.prepare(
    `INSERT INTO corrections
       (bankId, questionId, type, title, answerText, options, answer, explanation, images, titleImages, authorId, authorName, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (bankId, questionId) DO UPDATE SET
       type = excluded.type,
       title = excluded.title,
       answerText = excluded.answerText,
       options = excluded.options,
       answer = excluded.answer,
       explanation = excluded.explanation,
       images = excluded.images,
       titleImages = excluded.titleImages,
       authorId = excluded.authorId,
       authorName = excluded.authorName,
       updatedAt = excluded.updatedAt`,
  ).run(
    bankId,
    questionId,
    type,
    title,
    answerText,
    JSON.stringify(type === "subjective" ? [] : options),
    JSON.stringify(type === "subjective" ? [] : answer),
    String(req.body?.explanation ?? "").trim(),
    JSON.stringify(images),
    JSON.stringify(titleImages),
    req.user.id,
    req.user.displayName || req.user.username,
    Date.now(),
  );

  const row = db
    .prepare("SELECT * FROM corrections WHERE bankId = ? AND questionId = ?")
    .get(bankId, questionId);
  res.json({ correction: parseRow(row) });
});

/** 教师恢复原题 */
router.delete("/", authRequired, teacherRequired, (req, res) => {
  const bankId = String(req.body?.bankId ?? req.query.bankId ?? "").trim();
  const questionId = String(req.body?.questionId ?? req.query.questionId ?? "").trim();
  if (!bankId || !questionId) return res.status(400).json({ message: "缺少题目标识" });
  db.prepare("DELETE FROM corrections WHERE bankId = ? AND questionId = ?").run(bankId, questionId);
  res.json({ ok: true });
});

export default router;
