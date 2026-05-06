@echo off
setlocal
cd /d "%~dp0"

echo Starting WorkTrack...
echo.
echo If this window says Node.js is missing, install Node.js 22 or newer from https://nodejs.org/
echo.
npm start
pause
