import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import correctionRoutes from "./routes/corrections.js";
import feedbackRoutes from "./routes/feedback.js";
import { seedUsers } from "./seed.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

// 本地部署时，从原始真题目录提供 PDF 文件，供教师校对面板预览。
const sourcePdfDir = process.env.SOURCE_PDF_DIR || "F:/2026年高考化学真题（全国各地共22省）";
if (existsSync(sourcePdfDir)) {
  app.use("/source-pdfs", express.static(resolve(sourcePdfDir), {
    fallthrough: false,
    setHeaders(res) { res.setHeader("Content-Disposition", "inline"); },
  }));
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "quiz-server" }));
app.use("/api/auth", authRoutes);
app.use("/api/corrections", correctionRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/admin", adminRoutes);

const serverRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(serverRoot, "..");
const distDir = resolve(webRoot, "dist");
const distIndex = join(distDir, "index.html");

// 生产部署：同一个进程同时提供前端静态资源与 /api 接口（部署前先执行 npm run build）
app.use(express.static(distDir, { index: false, maxAge: "1h" }));

app.use((req, res) => {
  // 已构建过前端时，非接口地址回落到首页，交给前端路由；否则仍按接口 404 处理
  if (req.method === "GET" && !req.path.startsWith("/api") && existsSync(distIndex)) {
    return res.sendFile(distIndex);
  }
  res.status(404).json({ message: "接口不存在" });
});
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error("[server]", error);
  res.status(500).json({ message: error?.message || "服务器内部错误" });
});

const port = Number(process.env.PORT || 8787);
// 默认监听所有网卡，局域网 / 服务器上的其他人才能访问；只想本机用时设 HOST=127.0.0.1
const host = process.env.HOST || "0.0.0.0";

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

const created = await seedUsers();

app.listen(port, host, () => {
  console.log(`题库服务已启动：http://localhost:${port}`);
  if (host === "0.0.0.0") {
    lanAddresses().forEach((ip) => console.log(`  局域网访问：http://${ip}:${port}`));
  }
  if (!existsSync(distIndex)) {
    console.log("提示：未找到 dist/，当前只提供接口。请先执行 npm run build 再启动，前端页面才会一起发布。");
  }
  if (created.length) {
    console.log("已创建预置账号：");
    created.forEach((user) => console.log(`  ${user.username} / ${user.password} （${user.role}）`));
  }
});
