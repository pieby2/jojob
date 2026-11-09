@echo off
echo Starting Job Pilot...
cd /d "%~dp0"
start http://localhost:3000
node server.mjs
pause
