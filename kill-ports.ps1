# PowerShell script to kill processes using ports 3000 and 5000
Write-Host "Checking for processes on ports 3000 and 5000..." -ForegroundColor Yellow

# Function to kill process on a port
function Kill-Port {
    param($port)
    $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($process) {
        Write-Host "Found process $process on port $port" -ForegroundColor Yellow
        Stop-Process -Id $process -Force
        Write-Host "Killed process on port $port" -ForegroundColor Green
    } else {
        Write-Host "No process found on port $port" -ForegroundColor Green
    }
}

Kill-Port 3000
Kill-Port 5000

Write-Host "`nDone! You can now start the application." -ForegroundColor Green
