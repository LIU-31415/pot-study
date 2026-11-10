@echo off
chcp 65001 >nul
echo Updating Pot from source...
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-install.ps1"
echo.
pause
