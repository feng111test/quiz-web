<#
局域网发布：启动后端（含前端静态资源），同一 WiFi 下的人即可访问。

用法（项目根目录执行）：
  npm run start:lan                              # 用已有的 dist 直接启动
  npm run start:lan -- -Build                    # 先重新打包再启动
  pwsh -File deploy/start-lan.ps1 -Port 8080 -Build

别人访问：http://<你的IP>:8080/quiz/     （首页是 http://<你的IP>:8080/）
启动后控制台会打印所有可用的局域网地址。
#>
param(
    [int]$Port = 8080,
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

Write-Host "启动题库服务，端口 $Port（Ctrl+C 停止）" -ForegroundColor Green
node server/index.js
