@echo off
echo =============================================
echo  Stock Analysis - 전체 서버 시작
echo =============================================

echo [1] 백엔드 (FastAPI) 시작...
start "Backend" cmd /k "cd /d D:\02_Project\stock-analysis\backend && C:\Users\Yu\anaconda3\envs\stock_analysis\Scripts\uvicorn.exe main:app --reload --port 8000"

timeout /t 3 /nobreak > nul

echo [2] 프론트엔드 (Next.js 프로덕션) 시작...
start "Frontend" cmd /k "cd /d D:\02_Project\stock-analysis\frontend && npm run start"

timeout /t 3 /nobreak > nul

echo [3] ngrok 터널 시작...
start "Tunnel" cmd /k "ngrok http --domain=doze-backed-uncorrupt.ngrok-free.dev 3000"

echo.
echo =============================================
echo  외부 접속 주소:
echo  https://doze-backed-uncorrupt.ngrok-free.dev
echo =============================================
