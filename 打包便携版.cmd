@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  打包 QQGroupAlbumDownload 便携版 exe
echo ============================================

REM 用国内镜像，避免从 GitHub 下载超时
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/

REM 1) 构建前端（产出 web 目录）
echo.
echo [1/3] 构建前端...
call npx vue-cli-service build
if errorlevel 1 (
  echo 前端构建失败，终止
  pause
  exit /b 1
)

REM 2) 确保 Electron 二进制存在
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [2/3] Electron 二进制缺失，用镜像下载...
  pushd node_modules\electron
  call node install.js
  popd
) else (
  echo.
  echo [2/3] Electron 二进制已就绪
)

REM 3) 打包 portable：直接用本地 Electron 目录，跳过联网下载
REM    重试 3 次，规避 Windows 杀软扫描新 exe 造成的 EBUSY 锁定
echo.
echo [3/3] 打包 portable exe...
set OK=0
for /L %%i in (1,1,3) do (
  if !OK!==0 (
    echo   第 %%i 次尝试...
    if exist "dist\*.exe" del /q "dist\*.exe" >nul 2>&1
    call npx electron-builder --win portable -c.electronDist=node_modules/electron/dist
    if exist "dist\*.exe" (
      set OK=1
    ) else (
      echo   本次失败，10 秒后重试...
      timeout /t 10 /nobreak >nul
    )
  )
)

echo.
if !OK!==1 (
  echo ============================================
  echo  打包完成，产物：
  dir /b dist\*.exe
  echo ============================================
) else (
  echo 打包失败。若提示 EBUSY，通常是杀毒软件正在扫描 exe，关闭实时防护后重试。
)
pause
endlocal
