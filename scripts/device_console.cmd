@echo off
setlocal
chcp 65001 >nul
py -c "import zk" >nul 2>&1
if errorlevel 1 (
  echo Python with pyzk is required. Install with: py -m pip install pyzk
  pause
  exit /b 1
)
py "%~dp0device_console.py"
pause
