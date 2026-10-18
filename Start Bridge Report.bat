@echo off
setlocal
cd /d "%~dp0"
title Bridge Report

rem Pick up Node.js even if it was installed after this window's parent started
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p;%PATH%"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"
if defined NVM_SYMLINK set "PATH=%PATH%;%NVM_SYMLINK%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not find Node.js on this computer.
  echo Install the LTS version from https://nodejs.org, then run this again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Using Node.js %%v

rem Install or update packages when package.json changed since the last install
fc /b package.json node_modules\.installed-package.json >nul 2>nul
if errorlevel 1 (
  echo.
  echo Installing / updating... this can take a few minutes. Leave this window open.
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Take a screenshot of this window and send it to Claude.
    pause
    exit /b 1
  )
  copy /y package.json node_modules\.installed-package.json >nul
)

echo Starting Bridge Report...
call npm run app
if errorlevel 1 (
  echo.
  echo Something went wrong. Take a screenshot of this window and send it to Claude.
  pause
)
