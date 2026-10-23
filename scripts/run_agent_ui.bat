@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 agent_ui.py
if errorlevel 1 (
    echo.
    echo تعذر تشغيل واجهة وكيل الحضور.
    echo تحقق من تثبيت Python والمتطلبات من requirements.txt.
    pause
)
