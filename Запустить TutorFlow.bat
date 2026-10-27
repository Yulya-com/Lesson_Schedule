@echo off
title TutorFlow
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

echo.
echo   Запускаю TutorFlow...
echo   Адрес: http://localhost:5173/app/
echo.
echo   Это окно закрывать нельзя - пока оно открыто, приложение работает.
echo   Остановить: закройте окно или нажмите Ctrl+C.
echo.
start "" "http://localhost:5173/app/"
node serve.js
echo.
echo   Сервер остановлен.
pause
exit /b 0

:nonode
echo.
echo   Не найден Node.js. Установите его с https://nodejs.org
echo.
pause
exit /b 1
