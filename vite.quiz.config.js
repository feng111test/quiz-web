import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// 只打包「题库刷题」一个页面：不含 Word / PDF 导入，产物可直接发布到任意静态站点。
// root 直接指向 quiz 目录，这样首页就是发布目录的根，资源引用是 ./assets/...
const webRoot = import.meta.dirname;
const quizRoot = resolve(webRoot, "quiz");

export default defineConfig({
  root: quizRoot,
  // 相对路径：发布到二级目录（如 GitHub Pages 的 /仓库名/）也能打开
  base: "./",
  // 不复制 web/public：那里的 tessdata 是 PDF OCR 用的，刷题页不需要
  publicDir: false,
  build: {
    outDir: resolve(webRoot, "dist-quiz"),
    emptyOutDir: true,
    rollupOptions: {
      input: { quiz: resolve(quizRoot, "index.html") },
    },
  },
  plugins: [
    {
      name: "package-quiz-page",
      async closeBundle() {
        const out = resolve(webRoot, "dist-quiz");
        await cp(resolve(webRoot, "public/builtin-data"), resolve(out, "builtin-data"), { recursive: true });
        // GitHub Pages 默认跑 Jekyll，会忽略下划线开头的目录
        await writeFile(resolve(out, ".nojekyll"), "");
      },
    },
  ],
});
