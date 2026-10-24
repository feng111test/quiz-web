import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relative) {
  return fs.readFileSync(path.resolve(ROOT, relative), "utf8");
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

describe("构建配置：避免反编译暴露源码", () => {
  it("所有 vite 配置都显式关闭 source map，且未关闭压缩", () => {
    for (const config of ["vite.config.js", "vite.quiz.config.js"]) {
      const text = read(config);
      assert.match(
        text,
        /sourcemap\s*:\s*false/,
        `${config} 应显式设置 sourcemap: false，避免生产包附带可还原源码的 .map 文件`,
      );
      assert.ok(
        !/minify\s*:\s*false/.test(text),
        `${config} 不应关闭代码压缩`,
      );
    }
  });

  it("服务端静态目录只指向构建产物 dist，不暴露源码目录", () => {
    const text = read("server/index.js");
    // 只允许以 distDir 作为静态根
    assert.match(text, /express\.static\(\s*distDir/, "生产静态资源应只从 dist 目录提供");
    for (const dangerous of ["serverRoot", "webRoot", "__dirname", "process.cwd()"]) {
      assert.ok(
        !new RegExp(`express\\.static\\(\\s*${dangerous.replace(/[()]/g, "\\$&")}`).test(text),
        `不应把 ${dangerous} 直接作为静态目录，否则源码/配置可能被下载`,
      );
    }
    // 未匹配到静态文件时回落到首页，而不是返回目录列表
    assert.match(text, /res\.sendFile\(distIndex\)/);
    assert.ok(!text.includes("serve-index"), "不应启用目录列表中间件");
  });
});

const BUILD_DIRS = ["dist", "dist-quiz"];
for (const dir of BUILD_DIRS) {
  describe(`构建产物安全检查（${dir}）`, () => {
    const absolute = path.resolve(ROOT, dir);
    const exists = fs.existsSync(absolute);

    it("不应包含 source map、数据库、密钥或服务端源码", { skip: !exists && `${dir} 尚未构建，跳过` }, () => {
      const files = walk(absolute);
      const relative = files.map((file) => path.relative(absolute, file).replace(/\\/g, "/"));

      const maps = relative.filter((file) => file.endsWith(".map"));
      assert.deepStrictEqual(maps, [], `不应发布 .map 文件：${maps.join(", ")}`);

      const forbidden = relative.filter((file) =>
        /(^|\/)(server|node_modules)\//.test(file) ||
        /jwt-secret|quiz\.db(?:-wal|-shm)?$/i.test(file) ||
        /(^|\/)\.env(\.|$)/.test(file) ||
        /package(-lock)?\.json$/i.test(file),
      );
      assert.deepStrictEqual(
        forbidden,
        [],
        `构建产物不应包含服务端文件：${forbidden.join(", ")}`,
      );
    });

    it("前端 JS/CSS/HTML 中不应出现服务端密钥、预置密码或源码路径", { skip: !exists && `${dir} 尚未构建，跳过` }, () => {
      const files = walk(absolute).filter((file) => /\.(js|mjs|css|html)$/i.test(file));
      const markers = [
        "QUIZ_JWT_SECRET",
        "passwordHash",
        "jwt-secret",
        "admin123",
        "teacher123",
        "student123",
        "node:sqlite",
        "bcryptjs",
        "jsonwebtoken",
      ];
      for (const file of files) {
        if (fs.statSync(file).size > 5 * 1024 * 1024) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const marker of markers) {
          assert.ok(
            !text.includes(marker),
            `${path.relative(ROOT, file)} 不应包含服务端标记 "${marker}"`,
          );
        }
      }
    });

    it("前端包中不应残留本机绝对路径", { skip: !exists && `${dir} 尚未构建，跳过` }, () => {
      const files = walk(absolute).filter((file) => /\.(js|mjs|css|html)$/i.test(file));
      for (const file of files) {
        if (fs.statSync(file).size > 5 * 1024 * 1024) continue;
        const text = fs.readFileSync(file, "utf8");
        assert.ok(
          !/[A-Za-z]:\\Users\\|[A-Za-z]:\/Users\//.test(text),
          `${path.relative(ROOT, file)} 泄露了本机用户目录路径`,
        );
      }
    });
  });
}
