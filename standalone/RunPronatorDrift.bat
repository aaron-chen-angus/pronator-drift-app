@echo off
title Pronator Drift App

set "HERE=%~dp0"
set "NODE=%HERE%..\.node\node-v20.18.0-win-x64\node.exe"

if not exist "%NODE%" (
    echo ERROR: Bundled Node.js was not found at:
    echo   %NODE%
    echo.
    echo Make sure this folder is still inside the "Pronator Drift App" project.
    pause
    exit /b 1
)

echo Starting Pronator Drift App at http://localhost:8080 ...
echo.
echo   Keep this window open. Close it to stop the app.
echo.

start "" cmd /c "timeout /t 1 >nul & start http://localhost:8080"

"%NODE%" "%HERE%server.cjs"

pause
