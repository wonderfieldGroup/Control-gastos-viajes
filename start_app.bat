@echo off
title Control de Gastos de Viajes
echo ========================================================
echo  Iniciando Control de Gastos de Viajes Internacionales...
echo ========================================================
python start_app.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Intentando abrir index.html directamente en el navegador...
    start "" "index.html"
)
pause
