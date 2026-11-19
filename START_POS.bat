@echo off
title KRZ PRINT POS - Single Station SQLite Server
cd /d "%~dp0"
echo Starting KRZ PRINT POS (Single-Station SQLite Mode)...
start "" "http://localhost:8000"
node server.js
pause
