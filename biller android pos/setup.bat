@echo off
REM Quick start script for File Converter Android app with Monetization (Windows)

setlocal enabledelayedexpansion

echo.
echo 🚀 File Converter — Quick Setup with Monetization
echo ===================================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✓ Node.js %NODE_VERSION% detected
echo.

REM Step 1: Install npm packages
echo 📦 Installing npm packages...
call npm install --legacy-peer-deps
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm install failed
    pause
    exit /b 1
)
echo.

REM Step 2: Download libraries
echo 📥 Downloading libraries for offline use...
node build.js
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Build failed
    pause
    exit /b 1
)
echo.

REM Step 3: Initialize Capacitor
if not exist "capacitor.config.json" (
    echo ⚙️  Initializing Capacitor...
    call npx cap init "File Converter" com.fileconverter.app --web-dir www
) else (
    echo ✓ Capacitor already initialized
)
echo.

REM Step 4: Add Android platform
if not exist "android" (
    echo 🤖 Adding Android platform...
    call npx cap add android
) else (
    echo ✓ Android platform already added
)
echo.

REM Step 5: Sync
echo 🔄 Syncing web assets...
call npx cap sync
echo.

REM Success
echo ✅ Setup complete!
echo.
echo 💰 Monetization Features Enabled:
echo    - Free: 3 conversions/day with ads
echo    - Premium: Unlimited + no ads ($2.99)
echo    - Settings panel with usage stats
echo.
echo 📱 To open in Android Studio:
echo    npx cap open android
echo.
echo 📖 For monetization setup:
echo    Read: MONETIZATION.md (step-by-step guide)
echo    Read: MONETIZATION_QUICK.md (quick reference)
echo.
echo 💡 Tips:
echo    - After making changes to www\, run: npx cap sync
echo    - To test: Build -^> Run app on emulator
echo    - To build release: Build -^> Generate Signed Bundle / APK
echo.
pause
