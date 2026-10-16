# deploy/deploy-align.ps1 — 一键：打包 → 上传 → 蓝绿热切换 → 验收（阿里云生产）
#
# 为什么有它（2026-10-16 手工部署踩的两个坑，这里是防护）：
#   1. 用 stdin 把命令喂给 ssh 会被 CRLF 污染：hot-swap.sh 收到的 $1 变成 "…tar.gz\r"，
#      -f "$PACKAGE_FILE" 判定为假 → 走「未指定发布包，用现有代码热启动」分支 → 只换节点、没换代码。
#      本脚本把命令当**参数**传给 ssh，与换行符无关。
#   2. tar 的 --exclude 按**路径组件**匹配：--exclude='plugins' 会把 server/plugins/** 一起剔掉，
#      新节点起不来（ERR_MODULE_NOT_FOUND: server/plugins/registry.js）。本脚本只排除**精确路径**，
#      并且打包后逐条校验关键文件，缺一个就拒绝上传。
#
# 用法：
#   pwsh deploy/deploy-align.ps1 -DryRun          # 只打包+校验（不上传）
#   pwsh deploy/deploy-align.ps1                  # 打包 → 上传 → 热切换 → 验收
#   pwsh deploy/deploy-align.ps1 -Tag 20261016b   # 指定包名后缀
param(
  [string]$SshHost = "101.37.150.107",
  [string]$User = "root",
  [string]$Key = "$env:USERPROFILE\Downloads\aaa.pem",
  [string]$Tag = "",
  [string]$HotSwap = "/opt/hot-swap.sh",
  [int]$MaxBundleMB = 60,
  [switch]$DryRun,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo "server/index.js"))) { throw "找不到仓库根: $repo" }
if (-not (Test-Path $Key)) { throw "找不到 SSH 私钥: $Key" }
if (-not $Tag) { $Tag = Get-Date -Format "yyyyMMdd-HHmmss" }

$name = "update-bundle-align-$Tag.tar.gz"
$local = Join-Path $repo ".cache/$name"
$remote = "/root/$name"
$sshTarget = $User + "@" + $SshHost
$scpTarget = $sshTarget + ":" + $remote

$excludes = @(
  "--exclude=public/assets", "--exclude=public/fonts", "--exclude=public/patch.zip",
  "--exclude=public/dev", "--exclude=data/local-assets.json", "--exclude=data/local-fx.json"
)
$members = @(
  "package.json", "package-lock.json", "server", "shared", "data", "public",
  "tools", "scripts", "deploy", "docs", "LICENSE", "NOTICE.md", "THIRD-PARTY-NOTICES.md"
)
$must = @(
  "package.json", "server/index.js", "server/plugins/registry.js",
  "server/http/workshopServe.js", "server/http/appApi.js", "shared/infiniteMode.js",
  "public/js/ui/extensions.js", "public/js/screens/sweep.js", "public/data/chess.json"
)

Write-Host "== 1/4 打包 ==" -ForegroundColor Cyan
Remove-Item -Force $local -ErrorAction SilentlyContinue
Push-Location $repo
try {
  & tar -czf $local @excludes @members
  if ($LASTEXITCODE -ne 0) { throw "tar 失败 ($LASTEXITCODE)" }
} finally { Pop-Location }

$mb = [math]::Round((Get-Item $local).Length / 1MB, 1)
Write-Host ("   包体 {0} MB -> {1}" -f $mb, $local)
$listing = @(& tar -tzf $local)
$missing = @($must | Where-Object { $listing -notcontains $_ })
if ($missing.Count) { throw ("关键文件不在包里，已中止上传（排除规则误伤？）: " + ($missing -join ", ")) }
Write-Host ("   关键文件校验通过（{0} 项），条目 {1}" -f $must.Count, $listing.Count)
if ($mb -gt $MaxBundleMB) {
  Write-Warning ("包体 {0} MB 超过预期 {1} MB —— 是不是把 public/patch.zip 之类的大文件打进去了？" -f $mb, $MaxBundleMB)
}
if ($DryRun) { Write-Host "== -DryRun：到此为止（未上传）==" -ForegroundColor Yellow; return }

Write-Host "== 2/4 上传 ==" -ForegroundColor Cyan
& scp -i $Key -o StrictHostKeyChecking=accept-new $local $scpTarget
if ($LASTEXITCODE -ne 0) { throw "scp 失败 ($LASTEXITCODE)" }

Write-Host "== 3/4 蓝绿热切换（命令走参数，CRLF 免疫）==" -ForegroundColor Cyan
& ssh -i $Key -o StrictHostKeyChecking=accept-new $sshTarget "bash $HotSwap $remote"
$rollback = 'ssh ' + $sshTarget + ' "sed -i s/127.0.0.1:3001/127.0.0.1:3002/ /etc/nginx/sites-available/default; nginx -s reload; pm2 start stronghold-green"'
if ($LASTEXITCODE -ne 0) {
  Write-Host ("切换未完成。回滚： " + $rollback) -ForegroundColor Red
  exit 1
}
if ($SkipVerify) { return }

Write-Host "== 4/4 验收 ==" -ForegroundColor Cyan
$probe = "grep -oE 127.0.0.1:300[12] /etc/nginx/sites-available/default | head -1"
$active = (& ssh -i $Key -o StrictHostKeyChecking=accept-new $sshTarget $probe).Trim()
Write-Host "   活动后端: $active"
& ssh -i $Key -o StrictHostKeyChecking=accept-new $sshTarget "curl -s -m 8 http://$active/healthz | head -c 220"
& ssh -i $Key -o StrictHostKeyChecking=accept-new $sshTarget "curl -s -m 8 http://$active/api/app/version | head -c 220"
& ssh -i $Key -o StrictHostKeyChecking=accept-new $sshTarget "echo -n 'chess 模组算子命中: '; curl -s -m 20 http://$active/data/chess.json | grep -c chess_char_5_30_a"
& ssh -i $Key -o StrictHostKeyChecking=accept-new $sshTarget "echo -n 'assets 的 /workshop-assets/ 处数: '; curl -s -m 30 http://$active/data/assets.json | grep -o /workshop-assets/ | wc -l"
Write-Host ("回滚： " + $rollback) -ForegroundColor DarkGray
