<#
内网穿透发布：后台启动本地后端，再把端口暴露到公网。

用法（项目根目录执行）：
  npm run start:tunnel                                        # 默认执行 cpolar http 8080
  npm run start:tunnel -- -TunnelCommand "natapp"             # 用 natapp（配置写在 natapp.ini）
  npm run start:tunnel -- -TunnelCommand "frpc -c C:\frp\frpc.toml"
  pwsh -File deploy/start-tunnel.ps1 -Port 8080 -Build

跑起来后，把穿透工具显示的 https 地址发给别人：
  首页   https://你的域名/
  刷题页 https://你的域名/quiz/

停止：在窗口按 Ctrl+C，脚本会自动关掉后端进程。
#>
param(
    [int]$Port = 8080,
    [string]$TunnelCommand = "",
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $PSScriptRoot "env.ps1"
if (Test-Path $envFile) {
    . $envFile
} else {
    Write-Warning "未找到 deploy/env.ps1，将使用默认账号密码（admin123 / teacher123 / student123）。"
    Write-Warning "对外发布前请复制 deploy/env.example.ps1 为 deploy/env.ps1 并改掉密码。"
}

if ($Build -or -not (Test-Path (Join-Path $root "dist/index.html"))) {
    Write-Host "打包前端…" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "打包失败，已中止启动" }
}

$env:PORT = "$Port"
if (-not $env:HOST) { $env:HOST = "0.0.0.0" }

# 后端后台运行，日志写进 server/data（该目录已在 .gitignore 中）
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
    if (-not $ready) {
        throw "后端 30 秒内未就绪，请查看 $err"
    }

    Write-Host "后端已就绪：http://127.0.0.1:$Port" -ForegroundColor Green
    if (Test-Path $out) { Get-Content $out }

    # 优先级：命令行参数 > deploy/env.ps1 里的 QUIZ_TUNNEL_COMMAND > 默认 cpolar
    if (-not $TunnelCommand) { $TunnelCommand = $env:QUIZ_TUNNEL_COMMAND }
    if (-not $TunnelCommand) { $TunnelCommand = "cpolar http $Port" }
    Write-Host "启动穿透：$TunnelCommand" -ForegroundColor Cyan
    Write-Host "把下面输出的 https 地址发给别人（刷题页记得加 /quiz/）" -ForegroundColor Yellow
    Invoke-Expression $TunnelCommand
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "已停止后端进程" -ForegroundColor DarkGray
    }
}
