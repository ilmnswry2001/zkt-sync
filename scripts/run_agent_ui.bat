@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 agent_ui.py
if errorlevel 1 (
    echo.
    echo The attendance agent UI exited with an error. See the Python message above.
    pause
)
