import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = dirname(fileURLToPath(import.meta.url));

export const dataDir = resolve(serverRoot, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "quiz.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE,
    displayName  TEXT    NOT NULL,
    passwordHash TEXT    NOT NULL,
    role         TEXT    NOT NULL DEFAULT 'student',
    createdAt    INTEGER NOT NULL,
    updatedAt    INTEGER NOT NULL
  );

  -- 教师校对后的题目内容：以「题库 + 题目」为主键覆盖内置题库的原题
  CREATE TABLE IF NOT EXISTS corrections (
    bankId      TEXT    NOT NULL,
    questionId  TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    answerText  TEXT    NOT NULL DEFAULT '',
    options     TEXT    NOT NULL DEFAULT '[]',
    answer      TEXT    NOT NULL DEFAULT '[]',
    explanation TEXT    NOT NULL DEFAULT '',
    authorId    INTEGER,
    authorName  TEXT    NOT NULL DEFAULT '',
    updatedAt   INTEGER NOT NULL,
    PRIMARY KEY (bankId, questionId)
  );

  -- 学生反馈：只能提交，由教师处理（采纳 / 驳回）
  CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bankId        TEXT    NOT NULL,
    questionId    TEXT    NOT NULL,
    questionTitle TEXT    NOT NULL DEFAULT '',
    bankName      TEXT    NOT NULL DEFAULT '',
    reason        TEXT    NOT NULL DEFAULT '',
    suggestion    TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'open',
    authorId      INTEGER NOT NULL,
    authorName    TEXT    NOT NULL DEFAULT '',
    handlerId     INTEGER,
    handlerName   TEXT    NOT NULL DEFAULT '',
    handleNote    TEXT    NOT NULL DEFAULT '',
    createdAt     INTEGER NOT NULL,
    handledAt     INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status, createdAt);
  CREATE INDEX IF NOT EXISTS idx_corrections_bank ON corrections (bankId);
`);

// 旧数据库升级：为校正记录补充可编辑的题干图片字段。
const correctionColumns = new Set(db.prepare("PRAGMA table_info(corrections)").all().map((column) => column.name));
for (const column of ["images", "titleImages"]) {
  if (!correctionColumns.has(column)) {
    // NULL distinguishes legacy corrections (keep built-in images) from a new correction that intentionally removes every image.
    db.exec(`ALTER TABLE corrections ADD COLUMN ${column} TEXT`);
  }
}
