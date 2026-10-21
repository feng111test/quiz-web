// 与前端 src/quiz-model.js 保持一致的题型定义
export const QUESTION_TYPES = ["single", "multiple", "judge", "subjective"];
export const OBJECTIVE_TYPES = ["single", "multiple", "judge"];
export const SUBJECTIVE_TYPE = "subjective";

export const FEEDBACK_REASONS = [
  "题干有误",
  "答案有误",
  "解析有误",
  "选项有误",
  "题目残缺或乱码",
  "其他",
];

export const FEEDBACK_STATUS = {
  OPEN: "open",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
};
