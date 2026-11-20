@echo off
setlocal
cd /d "%~dp0"
set "TRACKER_NODE="
set "TRACKER_MODULES="
for /f "delims=" %%D in ('powershell.exe -NoProfile -Command "Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty InstallLocation"') do (
  if exist "%%D\dependencies\node\bin\node.exe" if exist "%%D\dependencies\node\node_modules\playwright\package.json" (
    set "TRACKER_NODE=%%D\dependencies\node\bin\node.exe"
    set "TRACKER_MODULES=%%D\dependencies\node\node_modules"
  )
)
if not defined TRACKER_NODE for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined TRACKER_NODE set "TRACKER_NODE=%%N"
if not defined TRACKER_NODE (
  echo Node.js was not found. See README.md for setup.
  pause
  exit /b 1
)
if defined TRACKER_MODULES set "NODE_PATH=%TRACKER_MODULES%"
"%TRACKER_NODE%" -e "require.resolve('playwright')" 2>nul
if errorlevel 1 (
  echo The tracker dependency is missing. See README.md for setup.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4178/ in your browser.
echo Leave this window open while tracking.
"%TRACKER_NODE%" src\dashboard.cjs
if errorlevel 1 pause
