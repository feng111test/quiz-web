# Natapp 排障

按状态行里的 `reason` 定位。改 token、端口、域名后必须**重启客户端**。

一开始不要探测本地端口。仅当 `forwarding` 打不开、访问失败或用户反馈不通时，再探测。

## reason 对照

客户端用 `-log=stdout` 启动后，出错行形如 `NATAPP status=error phase=auth reason=token_invalid code=1101 fatal=true msg="..."`。

**对 AI 的规则**：除网络类错误外，一旦出现下表中的明确业务 `reason`，立刻停止等待、可结束该进程，把结论和下一步告诉用户；不要因为客户端内部还会重试（例如 1103/1104/1202 的 `fatal=false`）就干等。只有网络类才继续观察。code 与 reason 对齐 natappauth。

| reason | code | 类型 | 含义与给用户的结论 |
| --- | --- | --- | --- |
| `token_invalid` | 1100 / 1101 | 明确 | authtoken 无效。到 https://natapp.cn/tunnel/lists 重新复制（去掉空白）后重启 |
| `tunnel_banned` | 1102 | 明确 | 隧道被禁用，看 `msg`，到会员中心处理 |
| `traffic_exhausted` | 1103 | 明确 | 本月流量已超限，去会员中心购买流量包后再开 |
| `tunnel_expired` | 1104 | 明确 | 隧道已过期，去会员中心续费后再开 |
| `account_locked` | 1201 | 明确 | 账号被锁定。发邮件到 support@mail.natapp.cn，注明账号（手机号）、相关问题，最好附截图 |
| `arrears` | 1202 | 明确 | 账户欠费，充值后再开 |
| `trial_ended` | 106 | 明确 | 免费 Web 试用结束。见下方实名一节 |
| `clienttoken_disabled` | 2000 | 明确 | clienttoken 已关闭，改用 `-authtoken=` |
| `auth_rejected` | 其他 | 明确 | 认证被拒，看 `code`/`msg`，让用户登录 https://natapp.cn 查看 |
| `ip_blocked` | — | 明确 | IP 被屏蔽。发邮件到 support@mail.natapp.cn，注明账号（手机号）、相关问题，最好附截图 |
| `already_registered` | — | 明确 | 同一条隧道已在别处运行。查出本机进程后**提示用户**先停旧的；**勿擅自杀**，用户明确要求后再杀并重开；仍报错再查其他电脑/服务 |
| `tcp_port_in_use` / `udp_port_in_use` | — | 明确 | 远端端口被占用。同上先提示，勿擅自杀；`msg` 里有端口号 |
| `local_unreachable` | — | 明确 | 连不上本机服务，同行 `local=` 是目标。见下方本机排查 |
| `auth_unreachable` | — | 网络 | 连不上认证服务器（`phase=auth`）。按下方「连不上服务器」**第一部分**排查 |
| `server_error` / `disconnected` / `connection_stale` / `smux_handshake_failed` | — | 网络 | 认证后连隧道服务端失败，或已连上又断。常见伴随 `status=reconnecting`。按下方「连不上服务器」**第二部分**排查 |

`status=diag` 行是客户端自带的网络自检结果，`msg` 里是多行诊断（换行被转义成 `\n`），网络类反复失败时可转述给用户。

排查依据对齐官网 [连不上网络错误调试排查详解](https://natapp.cn/article/networkerrors)（给人看的图文版）；本 skill 一律用 **`-log=stdout` 的 `NATAPP` 状态行**判断，不要依赖旧版界面里的红绿字或「连接认证服务器错误 N 秒后重试」文案。

## 连不上服务器（按日志分两步）

连上服务器分两步：**① 认证服务器 `auth.natapp.cn` → ② 隧道服务端**。`status=online` 才算成功，无需往下查。

实践中多数是 **DNS**。先确认/改成 **114DNS**（`114.114.114.114`；阿里 `223.5.5.5` 也可），能改就直接帮用户改，再继续。`config.ini` 里 **`http_proxy=` 必须留空**。

如何从日志判断卡在哪一步：

| 日志表现 | 卡在哪 |
| --- | --- |
| `status=error phase=auth reason=auth_unreachable`；或长期只有 `status=starting` / `authenticating`，不见 `connected` / `online` | **第一部分：认证服务器** |
| 已出现过 `connected` / 认证相关成功迹象后，反复 `status=reconnecting`，或 `reason=disconnected` / `connection_stale` / `smux_handshake_failed` / `server_error` | **第二部分：隧道服务端** |
| `status=online` 但访问卡、时好时坏；debug 日志里有 `dial tcp` / `i/o timeout` | 多为 DNS，仍先换 114 再查 |

### 共用：先处理 DNS（两步都要用）

1. 看当前 DNS：

```powershell
Get-DnsClientServerAddress -AddressFamily IPv4 | Format-Table -AutoSize
```

```bash
resolvectl status 2>/dev/null || cat /etc/resolv.conf          # Linux
scutil --dns | grep 'nameserver\[[0-9]*\]'                     # macOS
```

2. 不是 114 → 帮用户改（管理员/sudo）：

```powershell
# Windows：把「以太网」换成 Get-NetAdapter 看到的网卡名
Set-DnsClientServerAddress -InterfaceAlias "以太网" -ServerAddresses ("114.114.114.114","114.114.115.115")
ipconfig /flushdns
```

```bash
# Linux NetworkManager 示例（eth0 换成实际接口）
sudo nmcli con mod eth0 ipv4.dns "114.114.114.114 114.114.115.115"
sudo nmcli con mod eth0 ipv4.ignore-auto-dns yes
sudo nmcli con up eth0

# macOS
networksetup -setdnsservers Wi-Fi 114.114.114.114 114.114.115.115
```

域控强推 DNS 改不了 → 让用户找网管；可用 `nslookup auth.natapp.cn 114.114.114.114` 对比。

### 第一部分：连认证服务器（`phase=auth` / `auth_unreachable`）

对应官网「连接认证服务器错误」；stdout 里看 `phase=auth`、`reason=auth_unreachable`，不要等旧文案。

1. `nslookup auth.natapp.cn`  
   - 第一个 DNS Address 应为 `114.114.114.114`（或已设 DNS）  
   - 下方应解析出 `auth.natapp.cn` 的 IP；失败/超时 → 回到 DNS 步骤  
   - 对比：`nslookup auth.natapp.cn 114.114.114.114`
2. `ping auth.natapp.cn`；不通再 `tracert auth.natapp.cn`（Linux/macOS：`traceroute`）看卡在哪一跳  
3. `curl -I https://auth.natapp.cn`（或浏览器打开）应有正常响应  
   - DNS、ping 都好唯独 HTTPS 不通 → 路由器/公司防火墙（如深信服）可能拦 HTTPS，让网管加白  
4. 避免：脚本狂登、多开同一 authtoken、过期隧道还挂着开机自启 → 可能被防火墙拉黑。公网 IP 可查 http://ip.natapp.cn，按下方「联系官方」发邮件申请解黑

### 第二部分：连隧道服务端（`reconnecting` / 断连类 reason）

对应官网红色 **Reconnecting...**；stdout 里就是反复 `status=reconnecting`（可看 `retry=`）或断连类 `reason`。

1. **先查是否别处已跑同一条隧道**（一个 authtoken 只能一处登录；多开易触发屏蔽）。本机有重复 natapp / 同端口冲突时：**查出进程并提示用户**先停掉旧的再开；**不要擅自杀进程**。仅用户明确要求后再杀（优先按当前完整 authtoken；仍冲突且用户同意后再杀全部）：

```powershell
# 查询（用于提示）
Get-CimInstance Win32_Process -Filter "Name='natapp.exe'" | Select-Object ProcessId, CommandLine
# 用户明确要求后再执行：
# Get-CimInstance Win32_Process -Filter "Name='natapp.exe'" | Where-Object { $_.CommandLine -like '*-authtoken=<当前隧道authtoken>*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

```bash
pgrep -af '[n]atapp' || true
# 用户明确要求后再：pkill -f "natapp.*-authtoken=<当前隧道authtoken>" || true
```

   本机已停仍 `already_registered` → 再查其他电脑或已装的系统服务（`-service status`）
2. 再确认 114DNS（同上）  
3. 到 https://natapp.cn/tunnel/lists → 配置，记下该隧道的**服务器地址**和**端口**  
4. `nslookup <服务器地址>`，解析须正常  
5. `ping <服务器地址>`  
   - 延迟大致 <80ms 且不丢包较稳；丢包、>100ms 或剧烈抖动 → 先查本地网络  
   - ping 不通 → `tracert <服务器地址>`；前几跳就超时多为本地/局域网防火墙。把 tracert 结果 + http://ip.natapp.cn 的公网 IP 一并给客服（可能被防火墙误判拉黑）  
6. ping 稳之后测端口（Windows 可先装 Telnet 客户端，或用下面命令）：

```powershell
Test-NetConnection <服务器地址> -Port <服务器端口>
# 或: telnet <服务器地址> <服务器端口>
```

```bash
nc -vz <服务器地址> <服务器端口>
# 或: telnet <服务器地址> <服务器端口>
```

ping 通但端口不通 → 多为公司防火墙拦特殊端口，找网管  
7. 仍反复 `reconnecting`：确认已用 `-log=stdout`，把 `NATAPP` 状态行（含 `status=diag`）+ 上述 nslookup/ping/端口结果按「联系官方」发给售后

### 仍 online 但访问卡顿

多为 DNS 影响本地请求；换 114 后重启客户端。必要时把 loglevel 提到 DEBUG 再抓含 `i/o timeout` 的行转述用户（判断仍以 ASCII 字段为准）。

## 联系官方

需要人工处理时（账号锁定、IP 屏蔽、tracert 异常需解黑等），让用户发邮件到 **support@mail.natapp.cn**，邮件里写清：
1. 账号（注册手机号）
2. 相关问题（含 `NATAPP` 状态行里的 `reason` / `code` / `msg` / `status=diag` 原文）
3. 公网 IP（http://ip.natapp.cn）及 nslookup / ping / tracert / 端口探测结果
4. 最好附上 `-log=stdout` 输出截图

不要替用户发邮件，只给出上述联系方式与要点。

## reason=local_unreachable / 已 online 但 forwarding 打不开

这时才探测本机：

```powershell
Test-NetConnection 127.0.0.1 -Port <port>
```

```bash
curl -sI "http://127.0.0.1:<port>"
```

然后按下面查：

1. 本机服务是否已启动（Nginx / Apache / IIS / 开发服务器等）
2. 实际监听端口是否就是官网隧道的 `local_port`；不一致则到 https://natapp.cn/tunnel/lists 编辑隧道改端口，然后重启客户端
3. 服务是否只绑了 `localhost`：隧道本机 IP 用 `127.0.0.1`，不要填 localhost
4. 付费 Web 隧道是否未绑定域名

## 安装脚本提示 authtoken 输入错误或未填写

- URL 没带 token，或不是恰好 16 位字母数字
- 到 https://natapp.cn/tunnel/lists 重新复制，去掉空格/换行后再装

## 长时间停在 authenticating / reconnecting

- 长期 `starting` / `authenticating`、不见 `connected`/`online`：先排除 token 问题；仍不行 →「连不上服务器」**第一部分**
- 反复 `status=reconnecting`：先查是否多开同一 authtoken，再走**第二部分**；`retry=` 为本轮等待秒数
- 换 token 后必须用新的 `-authtoken=` 重启

## reason=trial_ended / 错误码 106 / 提示「试用已结束」

- 免费 Web 隧道约 2 小时试用到期且未实名
- 去 https://natapp.cn/member/realNameVerify 做人脸实名，隧道会自动恢复

## 提示需要实名 / 无法创建或使用 HTTP 隧道

- Web 隧道要人脸实名；TCP/UDP 注册手机号即可
- 试用期内访问太频繁可能提前断开，降低分享或完成实名

## 一键下载失败 / curl、irm 报错

- 先按「连不上服务器」确认 DNS / 网络
- Linux 先装 curl；Windows 用 Bypass 执行策略重试
- 或 https://natapp.cn/download 手动下载
- 不要短时间大量重复下载（CDN 可能限流）

## 不支持的操作系统或 CPU 架构

- Windows 误用了 `get.sh` → 改用 `get.ps1`
- 无预编译包 → https://natapp.cn/download 手动下载

## TCP/UDP 连不上

- 协议选错（网站用 Web；SSH/RDP/数据库用 TCP，禁止 HTTP）。重买用 VIP-1 预填：`https://natapp.cn/tunnel/buy/vip/vip1?proto=tcp&local_ip=127.0.0.1&local_port=<端口>&period=12`
- 购买时未指定 `remote_port`，或本地没在对应端口监听
- TCP 隧道即使本机服务没启动，客户端也可能不输出 `local_unreachable`。所以 TCP 场景下**没有报错不等于本机服务是通的**，这时直接探测 `local=` 那个端口

## 隧道过期 / inactive

- 到会员中心看到期时间，续费或重新购买，确认订单已支付

## 修改配置不生效

- 客户端没重启，或仍在用旧的 `config.ini` / 启动脚本
- 确认 `-authtoken` 与 ini 里一致

## Avg Conn Time 为 0.00ms

不是延时，忽略。以实际打开 Forwarding 为准。

## Mac 无法联网 / Permission denied

- 先 `chmod a+x natapp`
- 在系统设置里给客户端加安全/联网白名单
