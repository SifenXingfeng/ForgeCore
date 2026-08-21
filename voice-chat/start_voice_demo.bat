@echo off
rem ============================================
rem  ForgeMind 语音控制 Demo - 一键启动
rem  双击运行：规则/远程 AI 网关 + 可选语音控制台
rem ============================================
chcp 65001 >nul
call "%~dp0..\start-forgemind.bat" -IncludeAI -IncludeVoiceChat
