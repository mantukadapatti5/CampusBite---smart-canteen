@echo off
REM Wipes the database volume and rebuilds from scratch. Use this if logins still fail
REM (for example after an old/partial database).  WARNING: deletes all orders and users you created.
cd /d "%~dp0"
docker compose down -v
docker compose up --build
pause
