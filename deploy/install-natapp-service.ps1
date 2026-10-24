<#
把 natapp 装成 Windows 服务（开机自启），必须以管理员身份运行。

  pwsh -File deploy/install-natapp-service.ps1                 # 安装并启动
  pwsh -File deploy/install-natapp-service.ps1 -Status         # 查看状态
  pwsh -File deploy/install-natapp-service.ps1 -Uninstall      # 卸载
  pwsh -File deploy/install-natapp-service.ps1 -Port 8080      # 指定要用的那条隧道

注意：服务读不到当前用户的代理环境变量。若你的网络需要代理（Mihomo / Clash 等），
开机自启后可能认证失败，可在 ~/natapp/config.ini 里配 http_proxy= 后再重装服务。
#>
param(
    [int]$Port = 80,
    [switch]$Status,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Get-NatappDir {
    if ($env:NATAPP_INSTALL_DIR) { return $env:NATAPP_INSTALL_DIR }
    return Join-Path $HOME "natapp"
}

$dir = Get-NatappDir
$exe = Join-Path $dir "natapp.exe"
$file = Join-Path $dir "tunnels.json"

if (-not (Test-Path $exe)) { throw "没找到 $exe，请先安装 natapp 客户端" }
if (-not (Test-Path $file)) { throw "没找到 $file，先跑一次 deploy/start-tunnel.ps1 登记隧道" }

$json = Get-Content -Path $file -Raw -Encoding utf8 | ConvertFrom-Json
$hit = @($json.tunnels) | Where-Object { $_.local -match ":$Port$" } | Select-Object -First 1
if (-not $hit) { throw "tunnels.json 里没有本端口为 $Port 的隧道" }
$token = $hit.authtoken

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "请以管理员身份运行 PowerShell 后再执行本脚本" }

if ($Status) {
    & $exe -authtoken=$token -service status
    return
}
if ($Uninstall) {
    & $exe -authtoken=$token -service stop
    & $exe -authtoken=$token -service uninstall
    Write-Host "已卸载 natapp 服务" -ForegroundColor Green
    return
}

& $exe -authtoken=$token -service install
& $exe -authtoken=$token -service start
Write-Host "natapp 服务已安装并启动（隧道 $($token.Substring(0,4))**** → 本机 $Port）" -ForegroundColor Green
Write-Host "后端仍需单独启动：npm run start:lan -- -Port $Port" -ForegroundColor Yellow
