import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: true,
    // 前端统一用同源 /api，由 vite 转发到题库服务（npm run server）
    proxy: {
      "/api": {
        target: process.env.QUIZ_SERVER_URL || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/source-pdfs": {
        target: process.env.QUIZ_SERVER_URL || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        quiz: resolve(import.meta.dirname, "quiz/index.html"),
      },
    },
  },
});
