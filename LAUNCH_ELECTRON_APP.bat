@echo off
cd /d "%~dp0"
if exist "dist\win-unpacked\KRZ PRINT POS.exe" (
  start "" "dist\win-unpacked\KRZ PRINT POS.exe"
) else (
  call npm start
)
