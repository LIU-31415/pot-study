# 一键更新 Pot：重新构建前端 + 编译 + 安装 + 启动
# 用法：双击同目录下的「更新并安装.bat」
# 所有路径以脚本自身位置为基准，整个项目目录可以随意搬移

$ErrorActionPreference = "Stop"

# --- 路径基准：脚本所在目录即项目根 ---
$root       = $PSScriptRoot
$installDir = "$env:LOCALAPPDATA\Programs\pot-app"
$installExe = Join-Path $installDir "pot.exe"
$builtExe   = Join-Path $root "src-tauri\target\release\pot.exe"

Set-Location $root

# --- [0/4] 前置检查：缺什么就直说，别等到编译到一半才炸 ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "node not found in PATH. Install Node.js first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "node_modules\vite\bin\vite.js") -or -not (Test-Path "node_modules\@tauri-apps\cli\tauri.js")) {
    Write-Host "node_modules is incomplete. Run 'pnpm install' in:" -ForegroundColor Red
    Write-Host "  $root" -ForegroundColor Red
    exit 1
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
        $env:Path = "$cargoBin;$env:Path"
    } else {
        Write-Host "cargo not found. Install the Rust toolchain first." -ForegroundColor Red
        exit 1
    }
}

$started = Get-Date

Write-Host "`n=== [1/4] Building frontend (vite) ===" -ForegroundColor Cyan
node node_modules\vite\bin\vite.js build
if ($LASTEXITCODE -ne 0) { Write-Host "Frontend build FAILED" -ForegroundColor Red; exit 1 }

Write-Host "`n=== [2/4] Stopping running Pot ===" -ForegroundColor Cyan
Get-Process pot -ErrorAction SilentlyContinue | Stop-Process -Force
# 等进程真正退出，否则后面复制 exe 会因文件占用失败
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Process pot -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
}

Write-Host "`n=== [3/4] Compiling app (tauri, release) ===" -ForegroundColor Cyan
# 强制重跑 build script：否则改图标后增量编译会跳过资源重嵌，exe 图标不变
(Get-Item "src-tauri\build.rs").LastWriteTime = Get-Date
# 清空 beforeBuildCommand：前端在上一步已经单独构建过了，避免 tauri 再调一次 pnpm
'{"build":{"beforeBuildCommand":""}}' | Out-File (Join-Path $root "tauri.build-override.json") -Encoding utf8
node node_modules\@tauri-apps\cli\tauri.js build --bundles none --config tauri.build-override.json
if ($LASTEXITCODE -ne 0) {
    Write-Host "Compile FAILED - installed version left untouched" -ForegroundColor Red
    exit 1
}

# 编译报成功但产物没刷新 = 装进去的是旧程序，宁可停下
if (-not (Test-Path $builtExe)) {
    Write-Host "Compile reported success but $builtExe does not exist. Aborting install." -ForegroundColor Red
    exit 1
}
if ((Get-Item $builtExe).LastWriteTime -lt $started) {
    Write-Host "Compile reported success but the exe was not refreshed. Aborting install." -ForegroundColor Red
    Write-Host "  built: $((Get-Item $builtExe).LastWriteTime)  started: $started" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== [4/4] Installing and starting ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
if (Test-Path $installExe) {
    Copy-Item $installExe (Join-Path $installDir "pot.exe.bak") -Force
    Write-Host "Previous exe backed up to pot.exe.bak" -ForegroundColor DarkGray
}
Copy-Item $builtExe $installExe -Force
Start-Process -FilePath $installExe

Write-Host "`nDone. Pot restarted with your changes." -ForegroundColor Green
