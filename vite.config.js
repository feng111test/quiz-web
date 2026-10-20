import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: true,
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
