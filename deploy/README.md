# 发布与穿透说明

把本机服务发布给别人访问的所有命令都在这里。全部在项目根目录执行。

> 两台电脑不在同一局域网、需要远程控制目标机并异地部署时，见 [REMOTE.md](REMOTE.md)（Tailscale + 远程桌面 / SSH + Remote-SSH）。

## 一、命令总览

| 命令 | 作用 |
|---|---|
| `npm run build` | 打包前端（改了前端代码后必须跑） |
| `npm run start:lan` | 只局域网发布，同一 WiFi 内可用 |
| `npm run start:tunnel` | 穿透发布：启动后端 + 隧道，Ctrl+C 一起停 |
| `npm run stop:tunnel` | 停掉后端和穿透客户端 |
| `npm run check:network` | 网络体检：判断被拦的是哪个域名 |
| `npm run backup:db` | 备份数据库（账号 / 校对 / 反馈） |

## 二、首次准备

```powershell
copy deploy\env.example.ps1 deploy\env.ps1
```

编辑 `deploy\env.ps1`：改三个账号密码、填 `QUIZ_JWT_SECRET`。`env.ps1` 已在 `.gitignore` 中，不会提交。

**已经建好的账号要单独改密码**（预置账号只在首次启动时创建，环境变量对已存在的账号无效）：

```powershell
npm run seed -- set-password admin   你的密码
npm run seed -- set-password teacher 你的密码
```

## 三、穿透工具：natapp（已买固定域名）

token **不写进项目**，只登记在 `~/natapp/tunnels.json`（脚本自动按端口读取）：

```json
{ "tunnels": [ { "name": "quiz-web", "proto": "web", "local": "127.0.0.1:80", "authtoken": "...", "forwarding": "" } ] }
```

启动：

```powershell
npm run start:tunnel -- -Port 80
```

默认端口 80，与隧道后台配置的本地端口保持一致。

开机自启（需管理员 PowerShell）：

```powershell
pwsh -File deploy/install-natapp-service.ps1        # 安装并启动
pwsh -File deploy/install-natapp-service.ps1 -Status
pwsh -File deploy/install-natapp-service.ps1 -Uninstall
```

## 四、穿透工具：cpolar（备用，某些网络下 natapp 被拦）

### 安装

```powershell
$d = "$HOME\cpolar"
New-Item -ItemType Directory -Force -Path $d | Out-Null
Invoke-WebRequest "https://www.cpolar.com/static/downloads/cpolar-stable-windows-amd64.zip" -OutFile "$d\cpolar.zip"
Expand-Archive "$d\cpolar.zip" -DestinationPath $d -Force
& "$d\cpolar.exe" version
```

### 绑定账号（只需一次）

到 https://www.cpolar.com 注册 → 后台「验证」页复制 authtoken：

```powershell
& "$HOME\cpolar\cpolar.exe" authtoken 你的token
```

token 会存进 `~/.cpolar/cpolar.yml`，**不用写进项目**。

### 启动

```powershell
npm run start:tunnel -- -Tool cpolar
```

等价于执行：

```powershell
& "$HOME\cpolar\cpolar.exe" http 80 -region=cn -log=stdout
```

两个参数别漏：
- `-region=cn` 连国内节点（默认是美国区，慢）
- `-log=stdout` 否则终端不打印公网地址

启动后日志里出现 `Tunnel established at https://xxx.r7.cpolar.cn` 就是成功。也可以查管理接口：

```
http://127.0.0.1:4040/api/tunnels
```

### 停止

```powershell
npm run stop:tunnel -- -Tool cpolar
```

### 免费版限制

- 域名每次启动都变，发给别人的链接会失效
- 有在线时长和带宽限制，偶发 502
- 要固定域名需升级（基础版约 99 元/年，含 3 个子域名、2Mbps）

## 五、常见问题

**1. 隧道认证失败 / 报 auth_unreachable**

先体检：

```powershell
npm run check:network
```

判断规则：

| 现象 | 结论 |
|---|---|
| 正常校验 200 | 没问题 |
| 正常校验 000，忽略证书后 302/200 | HTTPS 被中间人解密 → 被上网行为管理设备拦截 |
| 两者都 000 | 域名被封 / DNS 失败 / 还没过网页认证 |

被拦时的应对顺序：
1. 换网络（手机热点 / 家里网）
2. 换穿透工具（natapp 被拦就试 cpolar，反之亦然）
3. 让本地代理真正从境外节点出去（Clash Verge 加置顶规则 `DOMAIN-SUFFIX,natapp.cn,你的代理组`），用 `curl -s -x http://127.0.0.1:7897 http://ip.natapp.cn` 确认出口 IP 变了才算生效

**2. 开着 Mihomo / Clash 时 natapp 连不上**

代理软件会劫持 DNS 成 fake-ip，natapp 是 Go 程序不吃系统代理。脚本已自动读取系统代理并透传；如需手动指定，在 `env.ps1` 里写：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
```

**3. 公网能打开但报 502**

本机后端没起来，或隧道的本地端口与后端端口不一致。检查：

```powershell
curl.exe -s http://127.0.0.1/api/health      # 端口按实际改
```

**4. 改了前端没生效**

先 `npm run build`，再重启（`npm run start:tunnel -- -Build` 可一步完成）。

**5. 别人打开很慢**

分卷里的图片已经外置（`public/builtin-data/images/`，616 张），题库包本身只有 6~14KB，
图片由浏览器按当前题目单独加载，所以现在慢的只可能是带宽本身。

部署时要**连图片目录一起传**，只传 `banks/` 会导致题目没有配图：

```powershell
Compress-Archive -Path dist -DestinationPath quiz-release.zip
```

如果哪天需要重新生成题库（`npm run build` 内部会跑 `prepare-default-bank.mjs`），
图片外置是生成流程的一部分，不需要额外操作；对已有分卷补做转换可以用
`node scripts/split-bank-images.mjs`。

## 六、安全与维护

- 登录凭证 7 天有效，改密码不会踢掉已登录的人；要一次清空所有登录状态，改 `QUIZ_JWT_SECRET` 并重启后端
- 数据库 `server/data/quiz.db` 存着账号、教师校对、学生反馈，**覆盖部署时别删**，定期 `npm run backup:db`
- 穿透地址依赖本机开机，关机别人就打不开
- 微信里直接点开穿透商的共享二级域名有被拦截的风险，建议发浏览器打开或绑定自有已备案域名
