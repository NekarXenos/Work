@echo off
setlocal
cd /d "%~dp0"

echo Stopping any previous archive server on port 4173...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":4173[ ].*LISTENING"') do (
  taskkill /F /PID %%p >nul 2>nul
)

where py >nul 2>nul
if not errorlevel 1 (
  echo Starting the shared archive server...
  start "Gerhard Archive Server" /b py server.py
  goto open_plaza
)

where python >nul 2>nul
if not errorlevel 1 (
  echo Starting the shared archive server...
  start "Gerhard Archive Server" /b python server.py
  goto open_plaza
)

where node >nul 2>nul
if not errorlevel 1 (
  echo Starting the shared archive server...
  start "Gerhard Archive Server" /b node server.js
  goto open_plaza
)

echo Neither Node.js nor Python was found on PATH.
echo Install Node.js or Python, then run this file again.
pause
exit /b 1

:open_plaza
timeout /t 1 /nobreak >nul
start "" "http://localhost:4173/Xeno_Plaza.html"
endlocal
