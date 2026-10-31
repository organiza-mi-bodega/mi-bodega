@echo off
cd /d "%~dp0"
title Mi Bodega V2 - Servidor local
color 0B
echo.
echo   MI BODEGA - VERSION 2
 echo.
echo Abre Chrome y escribe: http://localhost:8000
 echo.
echo No cierres esta ventana mientras uses Mi Bodega.
echo Para detener el servidor, presiona Ctrl + C.
echo.
python -m http.server 8000
if errorlevel 1 (
  echo.
  echo No se pudo iniciar. Revisa que Python este instalado y el puerto 8000 libre.
  pause
)
