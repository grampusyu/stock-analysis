# Stock Analysis - 전체 서버 자동 시작

# 백엔드
Start-Process "cmd.exe" -ArgumentList '/k "cd /d D:\02_Project\stock-analysis\backend && C:\Users\Yu\anaconda3\envs\stock_analysis\Scripts\uvicorn.exe main:app --reload --port 8000"' -WindowStyle Normal
Start-Sleep -Seconds 5

# 프론트엔드
$env:PATH = "C:\Program Files\nodejs;C:\Windows;" + $env:PATH
Start-Process "cmd.exe" -ArgumentList '/k "D:\02_Project\stock-analysis\start_frontend.bat"' -WindowStyle Normal
Start-Sleep -Seconds 12

# ngrok
Start-Process "cmd.exe" -ArgumentList '/k "C:\Windows\ngrok.exe http --domain=doze-backed-uncorrupt.ngrok-free.dev 3000"' -WindowStyle Normal

Write-Host "모든 서비스 시작 완료"
Write-Host "외부 접속: https://doze-backed-uncorrupt.ngrok-free.dev"
