# quiz-web 另一台电脑一键部署指南

本项目为 **Vite + Express(Node.js) + SQLite** 的题库刷题网页版。  
在另一台电脑上运行，只需拉取代码、安装依赖、执行启动脚本即可。

> 两台电脑不在同一局域网、需要从本机远程控制目标机时，见 [deploy/REMOTE.md](deploy/REMOTE.md)（Tailscale + 远程桌面 / SSH + Remote-SSH）。

---

## 一、新电脑需要配置什么

| 项目 | 说明 |
|------|------|
| **操作系统** | Windows（脚本为 PowerShell `.ps1`） |
| **Node.js** | 建议 LTS 版本（18+）。含原生模块 `@napi-rs/canvas`，换机器必须重新 `npm install` |
| **Git** | 用于从 GitHub 拉取代码 |
| **VS Code** | 可选，仅用于查看/修改代码；启动本身不需要 |
| **公网访问（可选）** | 需要内网穿透客户端：**natapp**（脚本已适配 `~/natapp/tunnels.json`）或 **cpolar** |
| **出网代理（可选）** | 若新电脑需代理才能上外网（natapp 需要认证），在 `deploy/env.ps1` 填 `HTTP_PROXY` / `HTTPS_PROXY` |

---

## 二、拉取代码后的操作步骤

在新电脑打开 **PowerShell**，进入你要存放项目的文件夹：

```powershell
# 1. 拉取代码
git clone https://github.com/feng111test/quiz-web.git
cd quiz-web

# 2. 安装依赖（必须，不能直接拷贝旧电脑的 node_modules）
npm install

# 3. 配置环境变量（强烈建议）
copy deploy\env.example.ps1 deploy\env.ps1
# 用记事本或 VS Code 打开 deploy/env.ps1，修改：
#   $env:QUIZ_JWT_SECRET = "改成一串很长的随机字符串"
#   $env:QUIZ_SEED_ADMIN_PASSWORD = "改成管理员密码"
#   $env:QUIZ_SEED_TEACHER_PASSWORD = "改成教师密码"
#   $env:QUIZ_SEED_STUDENT_PASSWORD = "改成学生密码"

# 4. （仅公网访问需要）安装 natapp 客户端，并把 authtoken 写入 ~/natapp/tunnels.json
#    或者在 env.ps1 里设置 $env:QUIZ_TUNNEL_COMMAND = "cpolar http 80"
```

> `deploy/env.ps1` 已在 `.gitignore` 中，不会上传到 GitHub，每台电脑独立配置，适合改密码。

---

## 三、一键启动（推荐）

项目已内置 `deploy/quick-start.ps1`，可在项目根目录执行：

### 3.1 局域网访问（同一 WiFi 下的人可打开）

```powershell
# 默认端口 8080，自动处理打包与启动
pwsh -File deploy\quick-start.ps1 -Mode lan

# 指定端口，并强制重新打包前端
pwsh -File deploy\quick-start.ps1 -Mode lan -Port 8080 -Build
```

启动后控制台会打印类似：
```
题库服务已启动：http://localhost:8080
  局域网访问：http://192.168.x.x:8080
```

别人访问：`http://<你的局域网IP>:8080/quiz/`

---

### 3.2 公网直接访问（内网穿透）

```powershell
# 默认用 80 端口 + 自动匹配 ~/natapp/tunnels.json 里的隧道
pwsh -File deploy\quick-start.ps1 -Mode tunnel

# 指定端口（要和 natapp 隧道的本地端口一致），并重新打包
pwsh -File deploy\quick-start.ps1 -Mode tunnel -Port 80 -Build

# 或指定 cpolar 命令
pwsh -File deploy\quick-start.ps1 -Mode tunnel -Port 8080
# 并在 deploy/env.ps1 设置：$env:QUIZ_TUNNEL_COMMAND = "cpolar http 8080"
```

脚本会：
1. 检查 Node.js / Git
2. 拉取代码（如未跳过）
3. `npm install`
4. 复制 `deploy/env.example.ps1` 为 `deploy/env.ps1`
5. 打包前端（如无 `dist/` 或加 `-Build`）
6. 启动后端 + 启动 natapp/cpolar 穿透

把输出的 `https` 地址发给别人，刷题页记得加 `/quiz/`：
- 首页：`https://<公网地址>/`
- 刷题页：`https://<公网地址>/quiz/`

停止：`Ctrl+C`，脚本会自动关掉后端。

---

## 四、防火墙与端口注意事项

1. **Windows 防火墙**：首次启动后端监听 `0.0.0.0:8080` 时，Windows Defender 可能弹出提示，请点 **“允许访问”**。如对方连不上，手动放行入站规则：端口 `8080`（TCP）。
2. **公网穿透**：natapp/cpolar 自身会出网连接穿透服务器，通常不需要额外开端口，但需确保新电脑能访问外网。
3. **端口冲突**：若 `8080` 被占用，用 `-Port 8081` 改端口；natapp 隧道本地端口要和这里一致。

---

## 五、原有启动命令速查（无需 quick-start 脚本也可直接用）

在项目根目录 PowerShell 执行：

```powershell
# 局域网一键启（推荐先试这个）
npm run start:lan

# 局域网一键启 + 指定端口 + 重新打包
npm run start:lan -- -Port 8080 -Build

# 公网一键启（需 natapp/cpolar）
npm run start:tunnel

# 停止公网穿透
npm run stop:tunnel

# 备份数据库（对外发布后建议定期跑）
npm run backup:db
```

---

## 六、换机器后的特别注意

1. **数据库是新的**：`server/data/` 不在 Git 里，新电脑首次启动会用 `env.ps1` 里的密码创建预置账号（admin / teacher / student）。旧电脑的题目校正记录、学生反馈不会自动搬过去，如需迁移请拷贝旧电脑的 `server/data/quiz.db`。
2. **原生模块重装**：`@napi-rs/canvas` 是平台相关的，新电脑必须 `npm install`，不能直接复制 `node_modules`。
3. **JWT 密钥变了**：`server/data/jwt-secret.txt` 也不在 Git 里，换机器后会生成新密钥，旧账号的登录 Token 会失效，需要重新登录（正常现象）。

---

如执行过程中遇到报错，可把错误信息贴出以便排查。