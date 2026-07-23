# Cloudflare 터널 자동 설정 스크립트
# 실행: powershell -ExecutionPolicy Bypass -File setup_tunnel.ps1

Write-Host "백엔드 터널 시작 중..." -ForegroundColor Cyan

# 백엔드 터널을 백그라운드로 실행하고 URL 캡처
$job = Start-Job -ScriptBlock {
    & cloudflared tunnel --url http://localhost:8000 2>&1
}

# URL이 나올 때까지 최대 30초 대기
$backendUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $output = Receive-Job $job
    $match = $output | Select-String "trycloudflare\.com"
    if ($match) {
        $backendUrl = ($match.Line | Select-String "https://[^\s]+trycloudflare\.com").Matches[0].Value
        if ($backendUrl) { break }
    }
}

if (-not $backendUrl) {
    Write-Host "백엔드 터널 URL을 찾지 못했습니다. start_tunnel.bat 을 수동으로 실행하세요." -ForegroundColor Red
    Stop-Job $job; Remove-Job $job
    exit 1
}

$wsUrl = $backendUrl -replace "^https://", "wss://"
Write-Host "백엔드 URL: $backendUrl" -ForegroundColor Green

# .env.local 업데이트
$envPath = "$PSScriptRoot\frontend\.env.local"
Set-Content -Path $envPath -Value "NEXT_PUBLIC_API_URL=$backendUrl`nNEXT_PUBLIC_WS_URL=$wsUrl`n" -Encoding UTF8
Write-Host ".env.local 업데이트 완료" -ForegroundColor Green

# 프론트엔드 터널 시작
Write-Host "프론트엔드 터널 시작 중..." -ForegroundColor Cyan
Start-Process cmd -ArgumentList "/k cloudflared tunnel --url http://localhost:3000" -WindowStyle Normal

Write-Host ""
Write-Host "=======================================" -ForegroundColor Yellow
Write-Host " 설정 완료!" -ForegroundColor Yellow
Write-Host " 이제 Next.js 서버를 재시작하세요:" -ForegroundColor Yellow
Write-Host "   frontend 폴더에서: npm run dev" -ForegroundColor White
Write-Host " 프론트엔드 터널 창의 URL로 외부 접속 가능합니다." -ForegroundColor Yellow
Write-Host "=======================================" -ForegroundColor Yellow

# 백엔드 터널 유지 (포그라운드)
Write-Host "백엔드 터널 실행 중 (이 창을 닫지 마세요)..."
Wait-Job $job
