# Run this script on your home/work PC before using Work Tracker remotely.

$model = "llama3.2"   # Change to match the model you have pulled in Ollama

# Check Node.js is available
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host "Download and install it from https://nodejs.org (LTS version)" -ForegroundColor Red
    Write-Host "Then run this script again." -ForegroundColor Red
    exit 1
}

# Check cloudflared is present
$cloudflared = Join-Path $PSScriptRoot "cloudflared-windows-amd64.exe"
if (-not (Test-Path $cloudflared)) {
    Write-Host ""
    Write-Host "ERROR: cloudflared-windows-amd64.exe not found in this folder." -ForegroundColor Red
    Write-Host "Download it from:" -ForegroundColor Red
    Write-Host "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Red
    Write-Host "and place it in: $PSScriptRoot" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Stopping any existing processes..."
taskkill /F /IM "ollama.exe" /T 2>$null
taskkill /F /IM "ollama app.exe" /T 2>$null

# Kill whatever is on port 8789 (the old Node server)
$conn = netstat -ano | Select-String "8789" | Select-String "LISTENING"
if ($conn) {
    $oldPid = ($conn -split '\s+')[-1].Trim()
    if ($oldPid -match '^\d+$') {
        taskkill /F /PID $oldPid 2>$null
        Write-Host "Stopped old server (PID $oldPid)"
    }
}
Start-Sleep -Seconds 2

Write-Host "Starting Ollama..."
$env:OLLAMA_ORIGINS = "*"
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Minimized -Environment @{ OLLAMA_ORIGINS = "*" }
Start-Sleep -Seconds 3

Write-Host "Pulling model if not already present..."
& ollama pull $model

Write-Host ""
Write-Host "Starting local server (handles CORS + note storage)..."
$serverScript = Join-Path $PSScriptRoot "server.js"
Start-Process "node" -ArgumentList $serverScript -WindowStyle Minimized
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Opening Cloudflare tunnel..."
Write-Host "------------------------------------------------------------"
Write-Host "When the URL appears below, copy it and paste it into"
Write-Host "the app Settings (gear icon) as the Cloudflare Tunnel URL."
Write-Host "------------------------------------------------------------"
Write-Host ""

& $cloudflared tunnel --url http://localhost:8789
