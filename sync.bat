@echo off
chcp 65001 >nul
rem ====================================================
rem  CertFlow 自動同期スクリプト
rem  Windows タスクスケジューラから数分おきに実行され、
rem  CertFlow フォルダの変更を自動で commit & push する。
rem  （変更が無ければ commit は失敗するだけで何もしない）
rem ====================================================
setlocal
cd /d "C:\Users\li.zhifeng\OneDrive - 株式会社テクノスジャパン\デスクトップ\cv4-starter\it-shinjins-week\it-shinjins-week\CertFlow"

git add -A
git commit -m "auto-sync %date% %time%"
git push origin main
endlocal
