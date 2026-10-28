@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动球鞋ERP行情服务...
  node mkt-server.js
) else (
  echo [!] 电脑上未安装 Node.js
  echo     请先到 https://nodejs.org/zh-cn 安装 LTS 版,装完重新双击本脚本
  echo     (或解压便携版 Node 后把它加入 PATH)
  pause
)
