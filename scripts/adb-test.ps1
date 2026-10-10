# scripts/adb-test.ps1 — Android APK 一键 ADB 安装与联机/单机测试脚本
$ErrorActionPreference = "Stop"

$AdbCandidates = @(
  "C:\Users\J1825\AppData\Local\Android\Sdk\platform-tools\adb.exe",
  "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
  "$env:ANDROID_HOME\platform-tools\adb.exe"
)

$Adb = $null
foreach ($c in $AdbCandidates) {
  if (Test-Path $c) { $Adb = $c; break }
}

if (-not $Adb) {
  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd) { $Adb = $cmd.Source }
}

if (-not $Adb) {
  Write-Error "未找到 adb.exe，请确认 Android SDK platform-tools 已安装。"
}

$Apk = Join-Path $PSScriptRoot "..\android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $Apk)) {
  Write-Error "APK 文件不存在: $Apk，请先运行 node scripts/build-android.mjs"
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 卫戍协议：盟约 · ADB 自动化安装与启动测试" -ForegroundColor Cyan
Write-Host " ADB 路径: $Adb" -ForegroundColor Gray
Write-Host " APK 路径: $Apk" -ForegroundColor Gray
Write-Host "======================================================" -ForegroundColor Cyan

Write-Host "`n[1/3] 正在检测已连接的 Android 设备..." -ForegroundColor Yellow
$devices = & $Adb devices | Where-Object { $_ -match "\tdevice$" }

if (-not $devices) {
  Write-Host "当前未检测到在线设备，正在尝试连接常见模拟器端口 (16384, 7555, 5555, 62001, 58526)..." -ForegroundColor Yellow
  $ports = @(16384, 7555, 5555, 62001, 58526)
  foreach ($p in $ports) {
    & $Adb connect "127.0.0.1:$p" 2>&1 | Out-Null
  }
  $devices = & $Adb devices | Where-Object { $_ -match "\tdevice$" }
}

if (-not $devices) {
  Write-Host "⚠ 未检测到任何在线 Android 设备或模拟器。" -ForegroundColor Yellow
  Write-Host "请确保："
  Write-Host "  1. 手机已开启「开发者选项」与「USB 调试」并插上电脑，或模拟器（如 MuMu/雷电）已启动；"
  Write-Host "  2. 手机屏幕弹出「允许 USB 调试」时点击【允许】。"
  Write-Host "`n脚本将在设备接入后自动继续安装 (等待中... 按 Ctrl+C 退出)..." -ForegroundColor Gray
  & $Adb wait-for-device
}

Write-Host "`n✔ 检测到活跃设备，开始安装 APK (约 619 MB)..." -ForegroundColor Green
& $Adb install -r -d $Apk

Write-Host "`n[2/3] 正在启动应用 (MainActivity)..." -ForegroundColor Green
& $Adb shell am start -n com.paper.stronghold.debug/com.paper.stronghold.MainActivity

Write-Host "`n[3/3] 应用已启动！正在输出核心运行日志 (按 Ctrl+C 退出监控)..." -ForegroundColor Cyan
& $Adb logcat -c
& $Adb logcat -v time -s "Stronghold" "NodeRunner" "Chromium" "Console" "*:E"
