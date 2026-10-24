# 异地部署与远程控制教程（Tailscale + RDP / SSH）

适用场景：

- 本机开发，另一台 **Windows 专业版** 电脑运行本项目；
- 两台电脑 **不在同一局域网**；
- 希望从本机远程操控目标机，并把 `quiz-web` 部署到目标机。

整体思路：用 **Tailscale** 把两台电脑组成加密虚拟局域网（不需要公网 IP、不需要路由器端口映射），再通过 **远程桌面（RDP）** 或 **SSH / Remote-SSH** 操作目标机。

> 相关文档：
> - [QUICK_START.md](../QUICK_START.md)：换电脑部署的最短步骤
> - [README.md](README.md)：局域网发布、natapp/cpolar 穿透、数据库备份

---

## 一、方案总览

| 能力 | 工具 | 说明 |
|---|---|---|
| 两台电脑组网 | Tailscale | 分配 `100.x.x.x` 虚拟 IP，走加密隧道 |
| 图形界面操控目标机 | Windows 远程桌面（RDP） | Win10/11 专业版自带被控端 |
| 命令行 / IDE 远程开发 | OpenSSH + Remote-SSH | 本机编辑，目标机执行命令 |
| 项目运行 | `npm run start:lan` | 目标机监听 `0.0.0.0:8080` |
| 本机访问 | `http://100.x.x.x:8080/` | 走 Tailscale 内网 |
| 给外部的人访问 | `npm run start:tunnel` | natapp / cpolar 穿透 |

推荐组合：

1. **Tailscale + RDP**：需要看目标机桌面、手动操作时使用。
2. **Tailscale + OpenSSH + Remote-SSH**：日常开发、部署、看日志。
3. **项目自带 `start:lan`**：目标机跑服务，本机通过 Tailscale IP 访问。

---

## 二、准备清单

| 项目 | 要求 |
|---|---|
| 目标机系统 | Windows 10 / 11 **专业版**（家庭版不能做 RDP 被控端） |
| 登录账号 | 必须有密码（无密码无法 RDP） |
| Node.js | 建议 **24.x**，与本机 `v24.22.0` 保持一致 |
| Git | 用于 `git clone` / `git pull` |
| 网络 | 两台电脑都能正常上网 |
| 可选 | ToDesk / RustDesk（Tailscale 不稳定时备选） |

---

## 三、Tailscale 组网

### 3.1 两台电脑都安装 Tailscale

下载地址：

- 官网：<https://tailscale.com/download/windows>
- 备用包：<https://pkgs.tailscale.com/stable/#windows>

安装完成后，任务栏会出现 Tailscale 图标。

### 3.2 登录同一个账号

两台电脑都点击 Tailscale 图标 → **Log in**，使用同一个账号（Google / Microsoft / GitHub / 邮箱均可）。

登录后，在 Tailscale 管理后台可以看到两台设备：

<https://login.tailscale.com/admin/machines>

建议给设备改名，例如：

- `dev-pc`（本机）
- `quiz-server`（目标机）

### 3.3 获取目标机的 Tailscale IP

在**目标机** PowerShell 执行：

```powershell
tailscale ip -4
# 例如输出：100.101.102.103
```

在**本机**查看设备列表：

```powershell
tailscale status
```

### 3.4 测试连通性

在本机执行：

```powershell
tailscale ping 100.101.102.103
ping 100.101.102.103
```

`tailscale ping` 能通说明两台设备已经在同一虚拟局域网。

### 3.5 常见问题

| 现象 | 排查 |
|---|---|
| 一直登录不上 | 检查网络、代理；Tailscale 需要访问其控制平面 |
| `tailscale ping` 不通 | 目标机是否开机、Tailscale 是否在线、是否同一账号 |
| 能 ping 但 RDP 连不上 | 目标机远程桌面是否开启、账号是否有密码、防火墙 |
| 连接很慢 | `tailscale netcheck` 查看是否走 DERP 中继 |
| 目标机休眠后离线 | 电源设置里关闭睡眠，或设置“接通电源时永不睡眠” |
| 国内网络不稳定 | 备选 ZeroTier，或远程桌面改用 ToDesk / RustDesk |

---

## 四、远程桌面（RDP）

### 4.1 目标机开启远程桌面

1. 打开 **设置 → 系统 → 远程桌面**。
2. 打开 **远程桌面** 开关。
3. 点击“选择可远程访问此电脑的用户”，确认你的账号在列表里。
4. 确认该账号**已设置密码**。

手动放行防火墙（一般开启远程桌面时会自动放行，连不上再执行）：

```powershell
New-NetFirewallRule -DisplayName "Remote Desktop" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
```

### 4.2 本机连接

```powershell
mstsc /v:100.101.102.103
```

输入目标机的用户名和密码即可。

可以在 `mstsc` 里保存 `.rdp` 文件，下次双击直接连接。常用选项：

- **本地资源 → 剪贴板**：两台电脑互相复制文字。
- **本地资源 → 驱动器**：把本机磁盘映射到目标机，方便传文件。
- **显示 → 分辨率**：按需调整。

### 4.3 注意事项

- Windows 客户端的 RDP 是**单会话**：你远程登录会把目标机本地用户挤下线。
- 如果目标机平时还有人使用，改用 **ToDesk / RustDesk**，它们是镜像屏幕，不会挤人。
- **不要把 3389 直接映射到公网**。只通过 Tailscale 内网访问；如必须公网，至少改端口、启用网络级别身份验证（NLA）、限制来源 IP。
- 建议在目标机开启 **需要网络级别身份验证**（默认开启）。

---

## 五、SSH 与 Remote-SSH

### 5.1 目标机安装 OpenSSH Server

在目标机**管理员 PowerShell** 执行：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
New-NetFirewallRule -Name sshd -DisplayName "OpenSSH Server" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

检查状态：

```powershell
Get-Service sshd
```

可选：把默认 Shell 改成 PowerShell 7：

```powershell
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Program Files\PowerShell\7\pwsh.exe" -PropertyType String -Force
```

### 5.2 本机连接

```powershell
ssh 你的用户名@100.101.102.103
```

首次连接会提示确认指纹，输入 `yes`。

### 5.3 免密登录（可选）

本机生成密钥：

```powershell
ssh-keygen -t ed25519
```

把公钥 `C:\Users\你的用户名\.ssh\id_ed25519.pub` 的内容追加到目标机：

```text
C:\Users\目标机用户名\.ssh\authorized_keys
```

如果登录的是管理员账号，Windows OpenSSH 默认读取：

```text
C:\ProgramData\ssh\administrators_authorized_keys
```

并需要修正权限（只允许 Administrators 和 SYSTEM 读取）。

### 5.4 用 Remote-SSH 开发

1. 在本机 IDE（VS Code 或支持 Remote-SSH 的兼容 IDE）安装 **Remote - SSH** 扩展。
2. `Ctrl+Shift+P` → **Remote-SSH: Connect to Host** → `你的用户名@100.101.102.103`。
3. 连接后打开目标机上的项目目录（例如 `C:\Users\你的用户名\quiz-web`）。
4. 在远程终端里执行：

```powershell
npm install
npm run build
npm run start:lan -- -Port 8080
```

这样就是“**本机写代码、目标机运行**”：编辑器在本机，文件和命令都在目标机。

如果 IDE 不支持 Remote-SSH，可以退化为：

- 本机改代码 → `git push` → 目标机 `git pull`；
- 或者直接 RDP 到目标机桌面里开发。

---

## 六、目标机部署 quiz-web

### 6.1 安装 Node.js 24.x

- 下载：<https://nodejs.org/en/download>
- 安装后验证：

```powershell
node -v
npm -v
```

> `@napi-rs/canvas` 是平台相关的原生模块，目标机必须重新 `npm install`，**不能直接复制本机的 `node_modules`**。

### 6.2 获取代码

```powershell
git clone https://github.com/feng111test/quiz-web.git
cd quiz-web
```

如果仓库是私有的，需要配置 GitHub PAT 或 SSH Key。

也可以从本机拷贝（见第七节“文件传输”）。

### 6.3 安装依赖与配置环境变量

```powershell
npm install
copy deploy\env.example.ps1 deploy\env.ps1
notepad deploy\env.ps1
```

至少修改以下项：

```powershell
$env:QUIZ_JWT_SECRET = "改成一串很长的随机字符串"
$env:QUIZ_SEED_ADMIN_PASSWORD = "管理员密码"
$env:QUIZ_SEED_TEACHER_PASSWORD = "教师密码"
$env:QUIZ_SEED_STUDENT_PASSWORD = "学生密码"
```

可选：

```powershell
# 教师校对面板的原卷 PDF 目录，不存在会自动跳过
$env:SOURCE_PDF_DIR = "F:/2026年高考化学真题（全国各地共22省）"

# 需要代理才能访问外网时
# $env:HTTPS_PROXY = "http://127.0.0.1:7897"
# $env:HTTP_PROXY  = "http://127.0.0.1:7897"
```

> `deploy/env.ps1` 已在 `.gitignore` 中，每台电脑独立配置，不会提交到仓库。

### 6.4 构建并启动

```powershell
npm run build
npm run start:lan -- -Port 8080
```

启动后，在**本机**浏览器访问：

```text
http://100.101.102.103:8080/
http://100.101.102.103:8080/quiz/
```

健康检查：

```powershell
curl.exe -s http://100.101.102.103:8080/api/health
```

### 6.5 给 Tailscale 之外的人访问（可选）

在目标机执行：

```powershell
npm run start:tunnel
```

- natapp：先在目标机配置 `~/natapp/tunnels.json`；
- cpolar：先绑定 authtoken，再执行 `npm run start:tunnel -- -Tool cpolar`；
- 改了前端要重新构建：`npm run start:tunnel -- -Build`。

停止穿透：

```powershell
npm run stop:tunnel
```

---

## 七、代码与数据同步

### 7.1 代码同步（推荐 Git）

本机：

```powershell
git add -A
git commit -m "更新说明"
git push
```

目标机：

```powershell
git pull
npm install        # 依赖有变化时
npm run build
```

然后重启服务。

### 7.2 数据库迁移

目标机的数据库在：

```text
server/data/quiz.db
```

本机当前约 36KB，包含账号、教师校对、学生反馈。

- **想保留现有数据**：把本机 `server/data/quiz.db` 复制到目标机同路径（先停服务）。
- **全新开始**：不复制，首次启动会按 `env.ps1` 创建预置账号；已有账号改密码用：

```powershell
npm run seed -- set-password admin 新密码
npm run seed -- set-password teacher 新密码
```

- `server/data/jwt-secret.txt` 不会随 Git 迁移，目标机会生成新密钥，旧登录 Token 失效属正常现象。
- 在目标机定期备份：

```powershell
npm run backup:db
```

### 7.3 文件传输

方式一：`scp`（目标机已开 SSH）

```powershell
scp .\server\data\quiz.db 你的用户名@100.101.102.103:C:\Users\你的用户名\quiz-web\server\data\quiz.db
```

方式二：Tailscale + Windows 共享

- 目标机共享一个文件夹；
- 本机资源管理器访问 `\\100.101.102.103\共享名`。

方式三：ToDesk / RustDesk 的文件传输功能。

---

## 八、开机自启（可选）

### 8.1 任务计划程序（最简单）

目标机打开 **任务计划程序** → 创建任务：

- 常规：勾选“不管用户是否登录都要运行”（按需）。
- 触发器：**登录时** 或 **启动时**。
- 操作：
  - 程序：`pwsh.exe`
  - 参数：`-NoProfile -File "C:\路径\quiz-web\deploy\start-lan.ps1" -Port 8080`
  - 起始于：`C:\路径\quiz-web`
- 条件：取消“只有在使用交流电源时才启动”（笔记本按需）。

### 8.2 NSSM / pm2（可选）

- NSSM：把 `node server/index.js` 注册为 Windows 服务，工作目录设为项目根目录。
- pm2：`npm i -g pm2 pm2-windows-startup`，再 `pm2 start server/index.js --name quiz-web`。

### 8.3 穿透客户端自启

仓库已提供：

```powershell
pwsh -File deploy/install-natapp-service.ps1        # 安装并启动
pwsh -File deploy/install-natapp-service.ps1 -Status
pwsh -File deploy/install-natapp-service.ps1 -Uninstall
```

---

## 九、安全清单

- [ ] Tailscale 后台开启设备审批（Device approval），离职/换机及时移除设备。
- [ ] RDP 只通过 Tailscale 访问，**不要**在路由器上映射 3389。
- [ ] RDP 账号使用强密码，保持“需要网络级别身份验证”。
- [ ] SSH 优先用密钥登录，必要时在 `sshd_config` 关闭密码登录。
- [ ] 穿透只暴露 Web 端口，不要暴露 22/3389。
- [ ] `deploy/env.ps1` 不进 Git，密码不要写在代码里。
- [ ] 定期 `npm run backup:db`，并异地保存备份。
- [ ] 目标机保持系统更新、开启防火墙。
- [ ] 使用 ToDesk/向日葵时设置强密码 + 设备白名单 + 二次验证。

---

## 十、备选方案

| 场景 | 方案 |
|---|---|
| Tailscale 连不上 | ZeroTier（同样组虚拟局域网） |
| 只想远程操作桌面 | ToDesk / RustDesk / 向日葵 |
| 只想让外部访问网页 | 项目自带 natapp / cpolar 穿透 |
| 需要稳定的公网地址 | 云服务器 + Nginx + frp/域名 |
| 目标机同时有人在用 | ToDesk / RustDesk（RDP 会挤掉本地用户） |
| 临时传文件 | ToDesk 文件传输 / `scp` / SMB |

---

## 十一、常见问题

### 1. RDP 提示“由于网络错误，连接失败”

- 目标机远程桌面是否开启；
- 账号是否有密码；
- 防火墙是否放行 3389；
- `tailscale ping` 是否通；
- 目标机是否处于睡眠。

### 2. SSH 提示 `Permission denied`

- 用户名是否正确（Windows 登录名，不一定是显示名）；
- 密码/密钥是否正确；
- 管理员账号的密钥要放到 `C:\ProgramData\ssh\administrators_authorized_keys`；
- 检查 `Get-Service sshd` 是否运行。

### 3. 网页 502 / 打不开

```powershell
# 在目标机执行
curl.exe -s http://127.0.0.1:8080/api/health
```

- 后端没起来：重新 `npm run start:lan`；
- 端口不一致：隧道本地端口与 `-Port` 保持一致；
- 防火墙未放行：放行对应 TCP 端口。

### 4. 改了前端不生效

```powershell
npm run build
# 再重启服务
```

或一步完成：

```powershell
npm run start:lan -- -Port 8080 -Build
```

### 5. `@napi-rs/canvas` 安装失败

- 确认 Node.js 版本为 24.x；
- 删除 `node_modules` 和 `package-lock.json` 后重新 `npm install`；
- 安装微软 VC++ 运行库（Visual C++ Redistributable）。

### 6. 端口被占用

```powershell
Get-NetTCPConnection -LocalPort 8080
```

换端口：

```powershell
npm run start:lan -- -Port 8081
```

### 7. 目标机重启后服务没起来

- 检查任务计划程序是否设置为“登录时/启动时”；
- 检查工作目录、PowerShell 路径是否正确；
- 查看任务计划程序的“上次运行结果”。

---

## 十二、命令速查

| 目的 | 命令（在哪台执行） |
|---|---|
| 查 Tailscale IP | `tailscale ip -4`（两台） |
| 测连通 | `tailscale ping 100.x.x.x`（本机） |
| 远程桌面 | `mstsc /v:100.x.x.x`（本机） |
| SSH 登录 | `ssh 用户名@100.x.x.x`（本机） |
| 拉取代码 | `git clone https://github.com/feng111test/quiz-web.git`（目标机） |
| 安装依赖 | `npm install`（目标机） |
| 配置环境 | `copy deploy\env.example.ps1 deploy\env.ps1`（目标机） |
| 构建 | `npm run build`（目标机） |
| 局域网/内网启动 | `npm run start:lan -- -Port 8080`（目标机） |
| 公网穿透 | `npm run start:tunnel`（目标机） |
| 停止穿透 | `npm run stop:tunnel`（目标机） |
| 备份数据库 | `npm run backup:db`（目标机） |
| 健康检查 | `curl.exe -s http://100.x.x.x:8080/api/health`（本机） |

---

## 十三、最小操作顺序（照着做）

1. 两台电脑安装 Tailscale，登录同一账号。
2. 目标机执行 `tailscale ip -4`，记下 `100.x.x.x`。
3. 目标机开启“远程桌面”。
4. 本机 `mstsc /v:100.x.x.x`，能进桌面即成功。
5. 目标机安装 Node.js 24.x。
6. 目标机 `git clone` 项目 → `npm install` → 复制并编辑 `deploy/env.ps1` → `npm run build`。
7. 目标机 `npm run start:lan -- -Port 8080`。
8. 本机浏览器打开 `http://100.x.x.x:8080/`。
9. （可选）目标机装 OpenSSH Server，本机用 Remote-SSH 开发。
10. （可选）按第八节配置开机自启。
