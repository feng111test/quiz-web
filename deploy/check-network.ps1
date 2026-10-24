<#
网络体检：判断穿透服务被拦在了哪一步。

用法：
  npm run check:network
  pwsh -File deploy/check-network.ps1 -Targets natapp.cn,auth.natapp.cn
  pwsh -File deploy/check-network.ps1 -SkipProxy      # 不测系统代理，只测直连

对每个域名做三次探测，据此判断：
  code=200/301/302           正常
  code=000 但 -k 后有响应     HTTPS 被中间人解密（证书被替换），典型的上网行为管理设备
  两者都是 000                域名被直接阻断，或 DNS / 出口不通
#>
param(
    [string]$Targets = "natapp.cn,auth.natapp.cn,www.cpolar.com",
    [switch]$SkipProxy
)

$ErrorActionPreference = "SilentlyContinue"
$timeout = 8
$targetList = @($Targets -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

function Get-Code {
    param([string]$Url, [switch]$Insecure)
    if ($Insecure) { return (curl.exe -s -k -m $timeout -o NUL -w "%{http_code}" $Url).Trim() }
    return (curl.exe -s -m $timeout -o NUL -w "%{http_code}" $Url).Trim()
}

function Get-Issuer {
    param([string]$Url)
    $cert = curl.exe -s -k -m $timeout -o NUL -w "%{certs}" $Url
    if (-not $cert) { return "" }
    $line = ($cert -split "`n" | Where-Object { $_ -match '^Issuer:' } | Select-Object -First 1)
    if (-not $line) { return "" }
    return ($line -replace '^Issuer:.*?CN=', '').Trim()
}

Write-Host "`n=== 本机网络 ===" -ForegroundColor Cyan
$reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$proxyOn = $reg -and $reg.ProxyEnable -eq 1
Write-Host ("系统代理: " + $(if ($proxyOn) { "开 " + $reg.ProxyServer } else { "关" }))
$procs = @(Get-Process | Where-Object { $_.ProcessName -match 'mihomo|clash|verge' })
Write-Host ("代理软件: " + $(if ($procs.Count) { ($procs.ProcessName | Select-Object -Unique) -join ', ' } else { "未运行" }))
$exitIp = (curl.exe -s -m $timeout http://ip.natapp.cn).Trim()
Write-Host ("出口公网 IP: " + $(if ($exitIp) { $exitIp } else { "取不到" }))

Write-Host "`n=== 域名探测 ===" -ForegroundColor Cyan
foreach ($t in $targetList) {
    $url = "https://$t"
    $code = Get-Code -Url $url
    $codeK = Get-Code -Url $url -Insecure
    $issuer = Get-Issuer -Url $url

    if ($code -match '^[23]\d\d$') {
        $verdict = "正常"
        $color = "Green"
    } elseif ($code -eq "000" -and $codeK -match '^[23]\d\d$') {
        $verdict = "HTTPS 被中间人解密（证书被替换），被上网行为管理设备拦截"
        $color = "Red"
    } elseif ($code -eq "000" -and $codeK -eq "000") {
        $verdict = "完全不通（DNS / 出口 / 域名被封）"
        $color = "Red"
    } else {
        $verdict = "异常"
        $color = "Yellow"
    }

    Write-Host ("`n" + $t) -ForegroundColor White
    Write-Host ("  正常校验: " + $code) -ForegroundColor $(if ($code -match '^[23]\d\d$') { "Green" } else { "Red" })
    Write-Host ("  忽略证书: " + $codeK) -ForegroundColor $(if ($codeK -match '^[23]\d\d$') { "Green" } else { "Red" })
    Write-Host ("  证书颁发: " + $(if ($issuer) { $issuer } else { "(无)" }))
    Write-Host ("  判断: " + $verdict) -ForegroundColor $color
}

if (-not $SkipProxy -and $proxyOn) {
    Write-Host "`n=== 走系统代理的出口 IP ===" -ForegroundColor Cyan
    $ipProxy = (curl.exe -s -m $timeout -x $reg.ProxyServer http://ip.natapp.cn).Trim()
    Write-Host ("代理出口: " + $(if ($ipProxy) { $ipProxy } else { "取不到" }))
    if ($ipProxy -and $ipProxy -eq $exitIp) {
        Write-Host "代理出口与直连相同 → 这些域名没有走代理节点出去" -ForegroundColor Yellow
    }
}

Write-Host "`n=== DNS 解析 ===" -ForegroundColor Cyan
foreach ($t in $targetList) {
    $ip = ((nslookup $t 2>$null | Select-String -Pattern "^\s*Address:\s" | Select-Object -Last 1) -replace '.*Address:\s*', '').Trim()
    Write-Host ("  " + $t.PadRight(24) + $(if ($ip) { $ip } else { "解析失败" }))
}

Write-Host "`n提示：若所有域名都是 000，先确认浏览器能正常上网（有些 WiFi 需要先过网页认证）。" -ForegroundColor DarkGray
