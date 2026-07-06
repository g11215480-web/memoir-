@echo off
rem Memoir launcher: fixed port so browser data (IndexedDB) never "disappears"
cd /d "%~dp0"
start /min cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:50937"
npx live-server --port=50937 --no-browser
