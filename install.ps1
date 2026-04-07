# PowerShell script to install all dependencies
Write-Host "Installing backend dependencies..." -ForegroundColor Green
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Green
    Set-Location client
    npm install
    Set-Location ..
    Write-Host "Installation complete!" -ForegroundColor Green
} else {
    Write-Host "Backend installation failed!" -ForegroundColor Red
    exit 1
}
