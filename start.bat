@echo off
REM One-click start for Windows. Requires Docker Desktop to be running.
cd /d "%~dp0"
echo Starting CampusBite (first run downloads and builds everything - please wait)...
docker compose up --build
pause
