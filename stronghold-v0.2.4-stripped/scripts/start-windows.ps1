<#
  卫戍协议：盟约 · Windows 启动脚本（PowerShell 版）。文档：docs\DEPLOY.md
  运行：右键 →「使用 PowerShell 运行」，或
        powershell -ExecutionPolicy Bypass -File scripts\start-windows.ps1 [-Port 3001] [launch.mjs 的其他参数]
  检查 Node.js（没有时可用 winget 安装）→ 首次运行 npm ci → tools\setup.mjs → 启动服务器并打开浏览器。
#>
# PositionalBinding off: a bare launch.mjs option (.\start-windows.ps1 --no-local) must land in $Rest, not in [int]$Port.
[CmdletBinding(PositionalBinding = $false)]
param(
  [int]$Port = 0,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)
$ErrorActionPreference = 'Continue'   # native tools report through $LASTEXITCODE
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Host.UI.RawUI.WindowTitle = '卫戍协议：盟约 - Stronghold Protocol'

function Pause-Exit([int]$code) {
  Write-Host ''
  Read-Host '按回车键关闭窗口 / Press Enter to close' | Out-Null
  exit $code
}

function Test-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  $v = (& node -v) -replace '^v', ''
  return [pscustomobject]@{ Path = $cmd.Source; Version = $v; Major = [int]($v.Split('.')[0]) }
}

$node = Test-Node
if (-not $node) {
  Write-Host '未找到 Node.js（需要 22 或更高，22 / 24 LTS）。' -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host '可以用 Windows 自带的 winget 安装：  winget install OpenJS.NodeJS.LTS'
    $ans = Read-Host '现在安装吗？[Y/n]'
    if ($ans -eq '' -or $ans -match '^(y|yes|是)$') {
      & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
      $node = Test-Node
    }
  } else {
    Write-Host '请从官网下载安装：https://nodejs.org/zh-cn/download'
  }
  if (-not $node) {
    Write-Host '安装完成后请重新打开本脚本（新窗口才能读到新的 PATH）。'
    Pause-Exit 1
  }
}
if ($node.Major -lt 22) {
  Write-Host "Node.js $($node.Version) 太旧，需要 22 或更高：winget upgrade OpenJS.NodeJS.LTS  或  https://nodejs.org/zh-cn/download" -ForegroundColor Red
  Pause-Exit 1
}

if (-not (Test-Path (Join-Path $Root 'node_modules\ws\package.json'))) {
  Write-Host '[首次运行] 正在安装依赖 npm ci ...' -ForegroundColor Cyan
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Host 'npm 安装依赖失败（网络？）。' -ForegroundColor Red; Pause-Exit 1 }
  }
}

$launchArgs = @('scripts\launch.mjs')
if ($Port -gt 0) { $launchArgs += @('--port', "$Port") }
if ($Rest) { $launchArgs += $Rest }
& node @launchArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n启动失败，请查看上面的错误信息。诊断：node tools\doctor.mjs" -ForegroundColor Red
  Pause-Exit $LASTEXITCODE
}
