@echo off
rem Double-click to play Afterlife on Windows.
rem Starts the game and opens it in your browser. Close this window (or press Ctrl+C) to stop it.
title Afterlife
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing, about a minute...
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)

if not exist public\cards\cards.json (
  echo Downloading the card database, first run only...
  call npm run fetch-cards
  if errorlevel 1 echo Card download failed - the game will use placeholder cards for now.
)

echo.
echo Starting Afterlife... your browser will open in a moment.
echo Leave this window open while you play. Close it to stop the game.
echo.
call npm run dev -- --open
pause
