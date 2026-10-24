// 工作台：在「题库刷题」与「Word 导入」两个内嵌应用之间切换
const TITLES = {
  quiz: "题库刷题 · 试卷学习工作台",
  word: "Word 导入 · 试卷学习工作台",
};

const buttons = Array.from(document.querySelectorAll(".mode-button"));
const frames = {
  quiz: document.getElementById("quiz-app"),
  word: document.getElementById("word-app"),
};

function selectMode(mode) {
  const next = frames[mode] ? mode : "quiz";
  buttons.forEach((button) => {
    const active = button.dataset.mode === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  Object.entries(frames).forEach(([name, frame]) => {
    if (frame) frame.classList.toggle("active", name === next);
  });
  document.title = TITLES[next] || "试卷学习工作台";
}

buttons.forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

const initialMode = new URLSearchParams(location.search).get("mode");
selectMode(initialMode === "word" ? "word" : "quiz");
