<#
停止穿透发布：停掉穿透客户端（natapp / cpolar）和本地后端。

用法（项目根目录执行）：
  npm run stop:tunnel                                # 停后端 + natapp(80 端口对应隧道) + cpolar
  npm run stop:tunnel -- -Port 8080                  # 指定端口对应的 natapp 隧道
  npm run stop:tunnel -- -All                        # 连本机的其他 natapp 进程一起停
  npm run stop:tunnel -- -Tool cpolar                # 只停 cpolar + 后端
  npm run stop:tunnel -- -Tool natapp                # 只停 natapp + 后端
  pwsh -File deploy/stop-tunnel.ps1 -OnlyBackend     # 只停后端，保留隧道

只杀三类进程：命令行含 server/index.js 的 node、natapp.exe、cpolar.exe。
不会动 vite 开发服务器或其他 node 进程。
#>
param(
    [int]$Port = 80,
    [ValidateSet("", "cpolar", "natapp")]
    [string]$Tool = "",
    [switch]$All,
    [switch]$OnlyBackend
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Get-NatappDir {
    if ($env:NATAPP_INSTALL_DIR) { return $env:NATAPP_INSTALL_DIR }
    return Join-Path $HOME "natapp"
}

# 1) 停后端
$backends = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*server/index.js*' })
if ($backends.Count) {
    $backends | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "已停止后端进程 PID $($_.ProcessId)" -ForegroundColor Green
    }
} else {
    Write-Host "没有运行中的后端进程" -ForegroundColor DarkGray
}

if ($OnlyBackend) { return }

# 2) 停 natapp：默认只停当前隧道那条，-All 才停全部
$natapps = @(Get-CimInstance Win32_Process -Filter "Name='natapp.exe'")
if ($Tool -eq "cpolar") {
    Write-Host "跳过 natapp（-Tool cpolar）" -ForegroundColor DarkGray
} elseif (-not $natapps.Count) {
    Write-Host "没有运行中的 natapp 进程" -ForegroundColor DarkGray
} elseif ($All) {
    $natapps | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "已停止 natapp 进程 PID $($_.ProcessId)" -ForegroundColor Green
    }
} else {
    $token = $null
    $file = Join-Path (Get-NatappDir) "tunnels.json"
    if (Test-Path $file) {
        try {
            $json = Get-Content -Path $file -Raw -Encoding utf8 | ConvertFrom-Json
            $hit = @($json.tunnels) | Where-Object { $_.local -match ":$Port$" } | Select-Object -First 1
            if ($hit) { $token = $hit.authtoken }
        } catch { }
    }
    if (-not $token) {
        Write-Warning "tunnels.json 里没有本端口为 $Port 的隧道，改加 -All 停止全部 natapp 进程"
        return
    }
    $matched = @($natapps | Where-Object { $_.CommandLine -like "*$token*" })
    if (-not $matched.Count) {
        Write-Host "没有匹配隧道 $($token.Substring(0,4))**** 的 natapp 进程" -ForegroundColor DarkGray
    } else {
        $matched | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "已停止 natapp 进程 PID $($_.ProcessId)（隧道 $($token.Substring(0,4))****）" -ForegroundColor Green
        }
    }
}

# 3) 停 cpolar：免费版一般只有一条隧道，直接按进程名停
if ($Tool -eq "natapp") {
    Write-Host "跳过 cpolar（-Tool natapp）" -ForegroundColor DarkGray
} else {
    $cpolars = @(Get-CimInstance Win32_Process -Filter "Name='cpolar.exe'")
    if (-not $cpolars.Count) {
        Write-Host "没有运行中的 cpolar 进程" -ForegroundColor DarkGray
    } else {
        $cpolars | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "已停止 cpolar 进程 PID $($_.ProcessId)" -ForegroundColor Green
        }
    }
}

# 4) 确认端口释放
Start-Sleep -Seconds 2
$still = Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue
if ($still) {
    Write-Warning "端口 $Port 仍被 PID $($still.OwningProcess) 占用"
} else {
    Write-Host "端口 $Port 已释放，公网地址现在会返回 502（正常）" -ForegroundColor Green
}
