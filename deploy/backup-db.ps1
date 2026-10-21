<#
备份数据库：账号、教师校对结果、学生反馈全在 server/data/quiz.db 里。
对外发布后建议每天跑一次。

用法：
  npm run backup:db
  pwsh -File deploy/backup-db.ps1 -Dest D:\题库备份
#>
param(
    [string]$Dest = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "server/data/quiz.db"

if (-not (Test-Path $src)) { throw "找不到数据库：$src" }

$destDir = if ($Dest) { $Dest } else { Join-Path $root "backups" }
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$name = "quiz-{0}.db" -f (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item $src (Join-Path $destDir $name)

Write-Host "已备份到 $(Join-Path $destDir $name)" -ForegroundColor Green
