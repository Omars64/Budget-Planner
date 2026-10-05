@echo off
setlocal
title Budgetly Android APK Build
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android-all.ps1" %*
set "BUILD_EXIT=%ERRORLEVEL%"
if not "%BUILD_EXIT%"=="0" echo Build failed. Read the error above; no APK should be distributed.
popd
echo.
pause
exit /b %BUILD_EXIT%
