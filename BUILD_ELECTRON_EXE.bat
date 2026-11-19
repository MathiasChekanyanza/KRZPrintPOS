@echo off
title Build KRZ PRINT POS Windows Desktop Executable
cd /d "%~dp0"
echo Installing Electron packaging dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo Failed to install dependencies. Please check your internet connection and try again.
  pause
  exit /b 1
)
echo.
echo Packaging KRZ PRINT POS into Windows .exe (dist folder)...
call npm run dist
echo.
echo Done! Check the "dist" folder for the packaged KRZ PRINT POS executable.
pause
