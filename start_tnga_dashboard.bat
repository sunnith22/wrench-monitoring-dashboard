@echo off
title Launch TNGA Impact Wrench Monitoring Dashboard
echo ========================================================
echo   Starting TNGA Impact Wrench Monitoring System (2nd Project)
echo ========================================================

cd /d "%~dp0\backend"
start "TNGA Wrench Backend API (Port 8140)" cmd /k "npm start"

timeout /t 2 /nobreak >nul

cd /d "%~dp0\frontend"
start "TNGA Wrench Frontend (Port 3010)" cmd /k "npm run dev"

echo.
echo Services launched!
echo Backend API: http://localhost:8140
echo Frontend UI: http://localhost:3010
echo.
pause
