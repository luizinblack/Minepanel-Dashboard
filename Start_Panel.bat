@echo off
title MinePanel Dashboard

cd /d C:\Users\Luiz Felipe\Desktop\Minepanel-Dashboard-main

echo ==============================
echo  Iniciando MinePanel...
echo ==============================

echo Instalando dependencias (caso necessario)...
call npm install

echo Iniciando painel...
start cmd /k "npm start"

timeout /t 5

echo Painel iniciado em http://localhost:3000
pause