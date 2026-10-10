$ErrorActionPreference = "Stop"

$BaseUrl = "https://workbench-cli.oss-cn-hangzhou.aliyuncs.com/latest"
$Archive = "workbench-windows-amd64.zip"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\workbench"
$TmpDir = Join-Path $env:TEMP ("workbench-install-" + (New-Guid).Guid)

New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

try {
    Write-Host "Downloading $Archive..."
    $ArchivePath = Join-Path $TmpDir $Archive
    Invoke-WebRequest -Uri "$BaseUrl/$Archive" -OutFile $ArchivePath -UseBasicParsing

    Write-Host "Extracting..."
    $ExtractDir = Join-Path $TmpDir "extract"
    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

    $Binary = Get-ChildItem -Path $ExtractDir -Recurse -Filter "workbench.exe" | Select-Object -First 1
    if (-not $Binary) {
        throw "Could not find workbench.exe in archive"
    }

    $TargetPath = Join-Path $InstallDir "workbench.exe"
    Copy-Item -Path $Binary.FullName -Destination $TargetPath -Force

    Write-Host "Adding to User PATH..."
    $RegKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    $UserPath = $RegKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($UserPath -notlike "*$InstallDir*") {
        $NewPath = ($UserPath.TrimEnd(';') + ';' + $InstallDir).TrimStart(';')
        $RegKey.SetValue('Path', $NewPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    }
    $RegKey.Close()

    $env:PATH = "$InstallDir;$env:PATH"

    Write-Host "Installed successfully to: $TargetPath"
    & $TargetPath version
} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
