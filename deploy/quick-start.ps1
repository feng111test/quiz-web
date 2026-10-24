<#
.SYNOPSIS
    quiz-web 一键部署/启动脚本（另一台电脑用）

.DESCRIPTION
    在新电脑上执行，完成：拉取代码、安装依赖、配置环境、启动服务。
    支持两种模式：
      - lan   : 局域网访问（同一 WiFi 下的人可打开 http://<IP>:<Port>/quiz/）
      - tunnel: 公网访问（内网穿透，natapp/cpolar 输出 https 地址）

.NOTES
    需要以普通用户权限运行 PowerShell（安装 natapp 服务除外）。
    脚本位于项目根目录的 deploy/ 文件夹，请在项目根目录执行。

#requires -Version 5.1

[CmdletBinding()]
param(
    # 启动模式：lan（局域网）或 tunnel（公网穿透）
    [ValidateSet('lan','tunnel')]
    [string]$Mode = 'lan',

    # 服务监听端口
    [int]$Port = 8080,

    # 是否强制重新打包前端
    [switch]$Build,

    # 跳过 git clone（适用于已有代码的目录）
    [switch]$SkipClone,

    # 跳过 npm install（适用于已装过依赖的目录）
    [switch]$SkipInstall,

    # Git 仓库地址（不跳过克隆时使用）
    [string]$GitUrl = 'https://github.com/feng111test/quiz-web.git',

    # 克隆到的目录（不跳过克隆时使用，默认当前目录下的 quiz-web）
    [string]$TargetDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# 颜色输出辅助
function Write-Info([string]$msg)  { Write-Host $msg -ForegroundColor Cyan }
function Write-Success([string]$msg) { Write-Host $msg -ForegroundColor Green }
function Write-Warn([string]$msg)   { Write-Host $msg -ForegroundColor Yellow }
function Write-ErrorEx([string]$msg) { Write-Host $msg -ForegroundColor Red }

# 取得项目根目录（脚本所在 deploy/ 的上一级）
$scriptDir = Split-Path -Parent $PSScriptRoot
$root = if ($TargetDir) { Resolve-Path $TargetDir -ErrorAction SilentlyContinue } else { $scriptDir }
if (-not $root) { $root = $scriptDir }
$root = Resolve-Path $root

Write-Info "================================================"
Write-Info " quiz-web 一键启动脚本"
Write-Info " 模式：$Mode  |  端口：$Port  |  项目根目录：$root"
Write-Info "================================================"

# ============================================================
# 1. 检查前置工具
# ============================================================
Write-Info "[1/6] 检查 Node.js 和 Git …"

$node = Get-Command 'node' -ErrorAction SilentlyContinue
if (-not $node) {
    Write-ErrorEx "未找到 Node.js，请先安装：https://nodejs.org/ （建议 LTS 版本）"
    exit 1
}
Write-Success "Node.js 版本：$($node.Version)"

$git = Get-Command 'git' -ErrorAction SilentlyContinue
if (-not $git -and -not $SkipClone) {
    Write-ErrorEx "未找到 Git，请先安装：https://git-scm.com/"
    exit 1
}
if ($git) { Write-Success "Git 已就绪" }

# ============================================================
# 2. 拉取代码（如未跳过）
# ============================================================
if (-not $SkipClone) {
    Write-Info "[2/6] 拉取代码 …"
    if (-not (Test-Path (Join-Path $root '.git'))) {
        if (Test-Path $root -PathType Container) {
            $items = Get-ChildItem -Path $root -Force
            if ($items.Count -gt 0) {
                Write-ErrorEx "目录 $root 不为空且不是 git 仓库，请清空后重试，或改用 -SkipClone"
                exit 1
            }
        }
        git clone $GitUrl $root
        if ($LASTEXITCODE -ne 0) { throw "git clone 失败" }
    } else {
        Write-Success "已是 git 仓库，跳过 clone"
        git -C $root pull
    }
    Set-Location $root
} else {
    Write-Info "[2/6] 已跳过 git clone"
    Set-Location $root
}

# ============================================================
# 3. 安装依赖（如未跳过）
# ============================================================
if (-not $SkipInstall) {
    Write-Info "[3/6] 安装 npm 依赖（首次或换机器必须执行，不可拷贝 node_modules）…"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
    Write-Success "依赖安装完成"
} else {
    Write-Info "[3/6] 已跳过 npm install"
}

# ============================================================
# 4. 配置环境变量文件
# ============================================================
Write-Info "[4/6] 检查环境变量文件 deploy/env.ps1 …"
$envExample = Join-Path $root 'deploy\env.example.ps1'
$envFile = Join-Path $root 'deploy\env.ps1'

if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile -Force
        Write-Success "已复制 deploy/env.example.ps1 -> deploy/env.ps1"
    } else {
        Write-Warn "未找到 deploy/env.example.ps1，将使用默认密码"
    }
} else {
    Write-Success "deploy/env.ps1 已存在"
}

Write-Warn "重要：请打开 deploy/env.ps1，修改 QUIZ_JWT_SECRET 和 预置账号密码，再启动服务。"
Write-Warn "       env.ps1 已在 .gitignore 中，不会提交到 GitHub。"

# ============================================================
# 5. 打包前端（如需要）
# ============================================================
$distIndex = Join-Path $root 'dist\index.html'
if ($Build -or -not (Test-Path $distIndex)) {
    Write-Info "[5/6] 打包前端（npm run build）…"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端打包失败" }
    Write-Success "前端打包完成"
} else {
    Write-Info "[5/6] 检测到已有 dist/，跳过打包（如需强制重新打包加 -Build）"
}

# ============================================================
# 6. 启动服务
# ============================================================
Write-Info "[6/6] 启动服务 …"

$env:PORT = "$Port"
if (-not $env:HOST) { $env:HOST = "0.0.0.0" }

# 加载 env.ps1（若存在）
if (Test-Path $envFile) { . $envFile }

switch ($Mode) {
    'lan' {
        Write-Success "启动局域网模式：http://0.0.0.0:$Port"
        Write-Info  "同一 WiFi 下他人可访问：http://<你的局域网IP>:$Port/quiz/"
        node server/index.js
    }
    'tunnel' {
        Write-Success "启动公网穿透模式：后端监听 0.0.0.0:$Port"
        Write-Info  "脚本会自动启动后端，再启动 natapp/cpolar 穿透"
        Write-Info  "请确保已安装 natapp 客户端，并配置 ~/natapp/tunnels.json"
        Write-Info  "或在 deploy/env.ps1 中设置 QUIZ_TUNNEL_COMMAND = \"cpolar http $Port\""

        & pwsh -NoProfile -File "$root\deploy\start-tunnel.ps1" -Port $Port -Build:$Build
    }
}
#>
