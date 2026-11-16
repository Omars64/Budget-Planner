@echo off
setlocal
title Budgetly Build and Release
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-android.ps1" %*
set "BUILD_EXIT=%ERRORLEVEL%"
if not "%BUDGETLY_NO_PAUSE%"=="1" pause
exit /b %BUILD_EXIT%
