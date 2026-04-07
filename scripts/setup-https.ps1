param(
  [string]$Ip = ""
)

$ErrorActionPreference = "Stop"

function Get-LanIp {
  try {
    # Prefer non-loopback IPv4 addresses that are "Preferred"
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -and $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
      Sort-Object -Property InterfaceMetric, AddressState
    $ip = ($ips | Where-Object { $_.AddressState -eq "Preferred" } | Select-Object -First 1).IPAddress
    if (-not $ip) { $ip = ($ips | Select-Object -First 1).IPAddress }
    return $ip
  } catch {
    return ""
  }
}

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  Write-Host "mkcert is not installed." -ForegroundColor Red
  Write-Host "Install it with one of:" -ForegroundColor Yellow
  Write-Host "  winget install -e --id FiloSottile.mkcert" -ForegroundColor Yellow
  Write-Host "  choco install mkcert -y" -ForegroundColor Yellow
  exit 1
}

if (-not $Ip) {
  $Ip = Get-LanIp
}

if (-not $Ip) {
  Write-Host "Could not auto-detect LAN IP. Run again with -Ip <your-ip>." -ForegroundColor Red
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

Write-Host "Using LAN IP: $Ip" -ForegroundColor Cyan
Write-Host "Generating certificates in: $certDir" -ForegroundColor Cyan

Push-Location $certDir
try {
  mkcert -install | Out-Null
  mkcert -cert-file dev-cert.pem -key-file dev-key.pem $Ip "localhost" "127.0.0.1"
  Write-Host "OK. Certs created:" -ForegroundColor Green
  Write-Host "  certs/dev-cert.pem" -ForegroundColor Green
  Write-Host "  certs/dev-key.pem" -ForegroundColor Green
  Write-Host ""
  Write-Host "Next: run 'npm run dev:https' from the project root." -ForegroundColor Yellow
} finally {
  Pop-Location
}

