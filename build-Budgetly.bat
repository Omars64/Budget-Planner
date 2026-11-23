@echo off
setlocal
title Budgetly Android and Windows Build and Release
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-android.ps1" %*
set "BUILD_EXIT=%ERRORLEVEL%"
if not "%BUILD_EXIT%"=="0" echo See the diagnostics log printed above for the step that stopped.
if not "%BUDGETLY_NO_PAUSE%"=="1" pause
exit /b %BUILD_EXIT%
