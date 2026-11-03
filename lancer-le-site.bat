@echo off
chcp 65001 >nul
title Site Shock Trooper
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py serveur.py
  goto fin
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serveur.py
  goto fin
)

echo Python n'est pas installe sur cet ordinateur.
echo Installe-le gratuitement depuis https://www.python.org/downloads/
echo (coche "Add python.exe to PATH" pendant l'installation), puis relance ce fichier.

:fin
pause
