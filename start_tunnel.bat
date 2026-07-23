@echo off
echo =============================================
echo  Cloudflare Tunnel 시작
echo =============================================
echo.
echo [1단계] 백엔드 터널 시작 (포트 8000)
echo  - 아래에 표시되는 https://xxxx.trycloudflare.com URL을 복사하세요.
echo  - 그 URL을 frontend\.env.local 의 NEXT_PUBLIC_API_URL 에 붙여넣으세요.
echo  - NEXT_PUBLIC_WS_URL 은 https -> wss 로 바꿔서 넣으세요.
echo  - 설정 후 frontend 서버를 재시작하세요 (npm run dev).
echo.
start "Backend Tunnel" cmd /k "cloudflared tunnel --url http://localhost:8000"

echo.
echo [2단계] 잠시 후 프론트엔드 터널 시작 (포트 3000)
echo  - 두 번째 창에 표시되는 URL이 외부 접속 주소입니다.
timeout /t 3 /nobreak > nul
start "Frontend Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3000"

echo.
echo 두 터널이 실행 중입니다.
echo 외부 접속은 Frontend Tunnel 창의 URL을 사용하세요.
