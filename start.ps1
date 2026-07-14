# 주식 분석 대시보드 실행 스크립트
Write-Host "Starting Stock Analysis Dashboard..." -ForegroundColor Cyan

# 백엔드 시작
$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "conda activate stock_analysis; cd '$PSScriptRoot\backend'; uvicorn main:app --reload --port 8000" -PassThru
Write-Host "Backend started (PID: $($backend.Id)) -> http://localhost:8000" -ForegroundColor Green

Start-Sleep -Seconds 2

# 프론트엔드 시작
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev" -PassThru
Write-Host "Frontend started (PID: $($frontend.Id)) -> http://localhost:3000" -ForegroundColor Green

Write-Host ""
Write-Host "Dashboard: http://localhost:3000" -ForegroundColor Yellow
Write-Host "API Docs:  http://localhost:8000/docs" -ForegroundColor Yellow
