@echo off
title Launch TNGA Pulse Monitoring Dashboard
echo ========================================================
echo   TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
echo   Launching TNGA Impact Wrench Monitoring Dashboard
echo ========================================================
echo.

echo Freeing ports 8143 and 3010 if occupied by previous sessions...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8143') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3010') do taskkill /f /pid %%a >nul 2>&1

echo.
echo Checking connection to Shop-Floor Line PC (\\172.16.105.234\DATA)...
if not exist Z:\ (
    echo Auto-connecting network share to Z: drive...
    net use Z: \\172.16.105.234\DATA /persistent:yes >nul 2>&1
)

echo 1/2. Starting Backend API on Port 8143...
start "TNGA Backend (Port 8143)" cmd /k "cd backend && npm start"

timeout /t 3 /nobreak >nul

echo 2/2. Starting Frontend on Port 3010...
start "TNGA Frontend (Port 3010)" cmd /k "cd frontend && npm run dev"

timeout /t 2 /nobreak >nul

echo.
echo ========================================================
echo   Services are running!
echo   Main Dashboard: http://localhost:3010
echo   Backend API:    http://localhost:8143/health
echo ========================================================
start http://localhost:3010
pause
