@echo off
title Vinychat DPI Bypass (Zapret Mode)
echo --- Vinychat Bypass Engine ---
echo This script will help you bypass WebRTC blocking in Russia.
echo.
echo 1. Downloading Zapret binaries...
curl -L -o zapret.zip https://github.com/bol-van/zapret-win-bundle/archive/refs/heads/master.zip
echo 2. Unzipping...
powershell -Command "Expand-Archive -Path zapret.zip -DestinationPath . -Force"
cd zapret-win-bundle-master\zapret-winws

echo 3. Starting Bypass for Vinychat...
echo [INFO] Using strategy: --dpi-desync=split2 --dpi-desync-split-pos=2
winws.exe --wf-tcp=443 --wf-udp=443 --dpi-desync=split2 --dpi-desync-split-pos=2 --filter-tcp=443 --filter-udp=443
pause
