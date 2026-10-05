@echo off
setlocal
title Budgetly Android Build and GitHub Release
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-android.ps1" %*
set "BUILD_EXIT=%ERRORLEVEL%"
if not "%BUILD_EXIT%"=="0" echo Release stopped. Read the error above; do not distribute an incomplete release.
popd
echo.
pause
exit /b %BUILD_EXIT%
