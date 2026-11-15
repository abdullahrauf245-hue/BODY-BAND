@echo off
rem Body Band: one double-click start for Windows.
rem First run: checks Node.js and the Microsoft runtime, installs the app, asks for the
rem Presage API key once. Every run: starts the app and opens it in the browser.
setlocal
cd /d "%~dp0"
title Body Band

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Opening its download page.
  echo Install the LTS version, then double-click BodyBand.bat again.
  if not defined BODYBAND_NO_BROWSER start "" https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%SystemRoot%\System32\vcruntime140_threads.dll" (
  echo.
  echo The camera SDK needs the Microsoft Visual C++ runtime, which this PC does not have yet.
  echo Opening the download. Run the file it downloads, then double-click BodyBand.bat again.
  if not defined BODYBAND_NO_BROWSER start "" https://aka.ms/vs/17/release/vc_redist.x64.exe
  pause
  exit /b 1
)

if exist node_modules goto installed
echo.
echo First run: installing Body Band. This downloads about 400 MB and can take a few minutes.
call npm install
if errorlevel 1 (
  echo.
  echo The install failed. Check the internet connection and try again.
  pause
  exit /b 1
)
:installed

rem The key prompt is deliberately not inside a ( ) block: Windows would read %KEY%
rem before the person had typed it.
if exist .env goto haskey
echo.
echo Paste your Presage API key here and press Enter.
echo It is saved only in a file called .env on this computer.
set "KEY="
set /p KEY=Key: 
if not defined KEY goto nokey
>.env echo PRESAGE_API_KEY=%KEY%
:haskey

echo.
echo Starting Body Band at http://localhost:3000
echo Keep this window open while you use it. Close it to stop.
if not defined BODYBAND_NO_BROWSER start "" http://localhost:3000
node server.js
echo.
echo Body Band has stopped.
pause
exit /b 0

:nokey
echo.
echo No key was entered, so nothing was saved. Double-click BodyBand.bat to try again.
pause
exit /b 1
