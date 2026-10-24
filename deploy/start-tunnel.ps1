<#
内网穿透发布：后台启动本地后端，再用 natapp 把端口暴露到公网。

用法（项目根目录执行）：
  npm run start:tunnel                                   # 默认 80 端口
  npm run start:tunnel -- -Port 8080                     # 指定端口（要和穿透隧道的本地端口一致）
  npm run start:tunnel -- -Build                         # 先重新打包前端
  npm run start:tunnel -- -Tool cpolar                   # 用 cpolar（某些网络会拦 natapp，可切换）
  npm run start:tunnel -- -Tool natapp                   # 用 natapp（已买固定域名时）
  pwsh -File deploy/start-tunnel.ps1 -Port 80 -TunnelCommand "cpolar http 80"

token 从 ~/natapp/tunnels.json 按端口自动匹配，不写进项目。
跑起来后把 natapp 输出的 https 地址发给别人：
  首页   https://你的地址/
  刷题页 https://你的地址/quiz/
停止：Ctrl+C，脚本会自动关掉后端。
#>
param(
    [int]$Port = 80,
    [string]$TunnelCommand = "",
    [ValidateSet("", "cpolar", "natapp")]
    [string]$Tool = "",
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-NatappDir {
    if ($env:NATAPP_INSTALL_DIR) { return $env:NATAPP_INSTALL_DIR }
    return Join-Path $HOME "natapp"
}

function Get-NatappToken {
    param([int]$LocalPort)
    $file = Join-Path (Get-NatappDir) "tunnels.json"
    if (-not (Test-Path $file)) { return $null }
    try {
        $json = Get-Content -Path $file -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        return $null
    }
    $hit = @($json.tunnels) | Where-Object { $_.local -match ":$LocalPort$" } | Select-Object -First 1
    if (-not $hit) { return $null }
    return $hit.authtoken
}

function Get-CpolarCommand {
    param([int]$LocalPort)
    $exe = Join-Path $HOME "cpolar\cpolar.exe"
    if (-not (Test-Path $exe)) {
        $cmd = Get-Command cpolar -EA SilentlyContinue
        if ($cmd) { $exe = "cpolar" } else { return $null }
    }
    # -region=cn 连国内节点；-log=stdout 才能在终端看到公网地址
    return "& `"$exe`" http $LocalPort -region=cn -log=stdout"
}

# 1) 账号密码等配置
$envFile = Join-Path $PSScriptRoot "env.ps1"
if (Test-Path $envFile) {
    . $envFile
} else {
    Write-Warning "未找到 deploy/env.ps1，将使用默认账号密码。"
    Write-Warning "对外发布前请复制 deploy/env.example.ps1 为 deploy/env.ps1 并改掉密码。"
}

# 2) 出网代理：env.ps1 没设就读系统代理（Mihomo / Clash 等场景 natapp 需要它）
if (-not $env:HTTPS_PROXY) {
    $reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -EA SilentlyContinue
    if ($reg -and $reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
        $proxy = $reg.ProxyServer
        if ($proxy -notmatch '^https?://') { $proxy = "http://$proxy" }
        $env:HTTPS_PROXY = $proxy
        $env:HTTP_PROXY = $proxy
        Write-Host "检测到系统代理 $proxy，已透传给穿透客户端" -ForegroundColor DarkGray
    }
}

# 3) 前端产物
if ($Build -or -not (Test-Path (Join-Path $root "dist/index.html"))) {
    Write-Host "打包前端…" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "打包失败，已中止启动" }
}

# 4) 决定穿透命令：命令行 > 环境变量 > natapp 自动匹配
if (-not $TunnelCommand) { $TunnelCommand = $env:QUIZ_TUNNEL_COMMAND }
if (-not $TunnelCommand -and $Tool -eq "cpolar") {
    $TunnelCommand = Get-CpolarCommand -LocalPort $Port
    if (-not $TunnelCommand) { throw "没找到 cpolar，请先安装或改用 -Tool natapp" }
}
if (-not $TunnelCommand -and $Tool -ne "cpolar") {
    $exe = Join-Path (Get-NatappDir) "natapp.exe"
    $token = Get-NatappToken -LocalPort $Port
    if ($token -and (Test-Path $exe)) {
        Write-Host "使用 tunnels.json 中 $($token.Substring(0,4))**** 对应的隧道" -ForegroundColor DarkGray
        $TunnelCommand = "& `"$exe`" -authtoken=$token -log=stdout"
    }
}
if (-not $TunnelCommand) { $TunnelCommand = Get-CpolarCommand -LocalPort $Port }
if (-not $TunnelCommand) { throw "没找到可用的穿透客户端（cpolar 或 natapp）" }

# 5) 启动后端（后台，日志进 server/data）
$env:PORT = "$Port"
if (-not $env:HOST) { $env:HOST = "0.0.0.0" }
$out = Join-Path $root "server/data/server-out.log"
$err = Join-Path $root "server/data/server-err.log"
$proc = Start-Process -FilePath "node" -ArgumentList "server/index.js" -PassThru -NoNewWindow `
    -RedirectStandardOutput $out -RedirectStandardError $err

try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
            if ($health.ok) { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { throw "后端 30 秒内未就绪，请查看 $err" }

    Write-Host "后端已就绪：http://127.0.0.1:$Port" -ForegroundColor Green
    if (Test-Path $out) { Get-Content $out }

    Write-Host "启动穿透：$TunnelCommand" -ForegroundColor Cyan
    Write-Host "把下面输出的 https 地址发给别人（刷题页记得加 /quiz/）" -ForegroundColor Yellow
    Invoke-Expression $TunnelCommand
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "已停止后端进程" -ForegroundColor DarkGray
    }
}
