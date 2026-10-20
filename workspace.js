const TITLES = {
  quiz: "题库刷题 · 试卷学习工作台",
  word: "Word 导入刷题 · 试卷学习工作台",
  pdf: "PDF 整理刷题 · 试卷学习工作台",
};

const buttons = document.querySelectorAll(".mode-button");
const frames = {
  quiz: document.getElementById("quiz-app"),
  word: document.getElementById("word-app"),
  pdf: document.getElementById("pdf-app"),
};

function selectMode(mode) {
  buttons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  Object.entries(frames).forEach(([name, frame]) => {
    frame.classList.toggle("active", name === mode);
  });
  document.title = TITLES[mode] || "试卷学习工作台";
}

buttons.forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

selectMode("quiz");
