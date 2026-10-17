# deploy/build-android.ps1 - build the APK, refuse to install a stale one, then install.
#
# 2026-10-16 的三个坑，这里是防护：
#   1. 构建失败（语音门禁 / 打包步骤）却照样 adb install 旧包 -> 现象是每次 Success 但内容没变。
#      本脚本：构建非 0 直接退出，不安装；并比对 APK 时间戳，没变也拒绝安装。
#   2. 打包门禁拒绝多余的语音/资源：看提示处理，不要用装旧包绕过。
#   3. Windows 文件锁 EPERM: rm .cache/android-bundle-staging：构建前先清这两个 staging 目录。
#      只停 Gradle 守护进程；绝不盲杀 node（可能正是运行本脚本的工具自身）。
#
# 用法: pwsh deploy/build-android.ps1 [-SkipInstall] [-DryRun] [-Adb <path>]
param(
  [switch]$SkipInstall,
  [switch]$DryRun,
  [string]$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo 'scripts/build-android.mjs'))) { throw "找不到仓库根: $repo" }
$apk = Join-Path $repo 'android/app/build/outputs/apk/debug/app-debug.apk'
$log = Join-Path $repo '.cache/build-android.log'

Write-Host '== 1/4 清理上次构建残留 ==' -ForegroundColor Cyan
foreach ($rel in @('.cache/android-bundle-staging', '.cache/patch-bundle-staging')) {
  $d = Join-Path $repo $rel
  if (Test-Path $d) {
    try { Remove-Item -Recurse -Force $d -ErrorAction Stop; Write-Host "   已清理 $rel" }
    catch { Write-Warning "清理失败（文件被占用？关掉残留 java.exe）: $rel" }
  }
}
$gradlew = Join-Path $repo 'android/gradlew.bat'
if (Test-Path $gradlew) { try { & $gradlew --stop 2>&1 | Out-Null } catch {} }

if ($DryRun) {
  Write-Host '== -DryRun：未构建、未安装 ==' -ForegroundColor Yellow
  if (Test-Path $apk) { Write-Host ('   APK 现状: ' + (Get-Item $apk).LastWriteTime + '  ' + [math]::Round((Get-Item $apk).Length/1MB,1) + ' MB') }
  else { Write-Host '   还没有 APK' }
  return
}

$before = $null
if (Test-Path $apk) { $before = (Get-Item $apk).LastWriteTime }
Write-Host '== 2/4 构建（失败即停）==' -ForegroundColor Cyan
Push-Location $repo
try {
  # 不把 node 的输出接进 PowerShell 管道：它往 stderr 写进度条时，PowerShell 会把每行当成
  # NativeCommandError，$ErrorActionPreference='Stop' 会当场中断（2026-10-17 实测）。
  # 直接重定向到日志文件，再用退出码判断成败。
  # 用 cmd 包一层：PowerShell 5.1 会把原生程序的 stderr 每一行当成 NativeCommandError，
  # 在 $ErrorActionPreference='Stop' 下直接抛（node 的进度条正是写 stderr 的）。
  cmd /c "node scripts/build-android.mjs > .cache\build-android.log 2>&1"
  $code = $LASTEXITCODE
  Get-Content $log -Tail 8 | ForEach-Object { Write-Host ('   ' + $_) }
}
finally { Pop-Location }
if ($code -ne 0) {
  Write-Host "✘ 构建失败 (exit $code) —— 不安装任何东西。" -ForegroundColor Red
  Write-Host '   日志尾部：' -ForegroundColor DarkGray
  Get-Content $log -Tail 12 | ForEach-Object { Write-Host "   $_" }
  exit 1
}

Write-Host '== 3/4 校验 APK 是这一次构建的 ==' -ForegroundColor Cyan
if (-not (Test-Path $apk)) { throw "构建返回 0 但没有 APK: $apk" }
$after = (Get-Item $apk).LastWriteTime
Write-Host ('   APK ' + [math]::Round((Get-Item $apk).Length/1MB,1) + ' MB   ' + $before + ' -> ' + $after)
if ($before -and $after -eq $before) { Write-Host '✘ 时间戳没变（没有真正重建）—— 拒绝安装。' -ForegroundColor Red; exit 1 }

if ($SkipInstall) { Write-Host '== -SkipInstall：未安装 ==' -ForegroundColor Yellow; return }
Write-Host '== 4/4 安装 ==' -ForegroundColor Cyan
if (-not (Test-Path $Adb)) { throw "找不到 adb: $Adb" }
& $Adb install -r -d $apk
if ($LASTEXITCODE -ne 0) { throw "adb install 失败 ($LASTEXITCODE)" }
Write-Host '✔ 完成。首次启动会重新解压 bundle（2-5 分钟）。' -ForegroundColor Green
Write-Host '  核对：adb shell run-as com.paper.stronghold.debug cat files/bundle/.bundle_version' -ForegroundColor DarkGray
