@echo off
setlocal
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  echo.
  echo   [!] 未找到 Python。请先安装 Python 3.9+，或使用任意静态服务器打开本目录。
  echo.
  pause
  exit /b 1
)

%PY% server.py --open
if errorlevel 1 pause
