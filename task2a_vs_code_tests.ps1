# ============================================================
# AtithiSarthi / ServeHotels - Task 2A local verification
# Run from the PROJECT ROOT in VS Code PowerShell terminal.
# This script does not touch Supabase directly.
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Task 2A Local Verification ==="
Write-Host ""

if (-not (Test-Path ".\backend")) {
    throw "Run this script from the project root. '.\backend' was not found."
}

Push-Location ".\backend"
try {
    Write-Host "[1/5] Payment hardening tests"
    npm run test:payment-hardening
    if ($LASTEXITCODE -ne 0) { throw "test:payment-hardening failed" }

    Write-Host ""
    Write-Host "[2/5] Golden pricing fixtures"
    npm run test:golden-pricing
    if ($LASTEXITCODE -ne 0) { throw "test:golden-pricing failed" }

    Write-Host ""
    Write-Host "[3/5] Room checkout validator"
    npm run verify:room-checkout-validator
    if ($LASTEXITCODE -ne 0) { throw "verify:room-checkout-validator failed" }

    Write-Host ""
    Write-Host "[4/5] Frontend runtime config source-safety"
    npm run verify:frontend-runtime-config-source-safe
    if ($LASTEXITCODE -ne 0) { throw "verify:frontend-runtime-config-source-safe failed" }

    Write-Host ""
    Write-Host "[5/5] Staff orders release verification"
    npm run verify:staff-orders-release
    if ($LASTEXITCODE -ne 0) { throw "verify:staff-orders-release failed" }

    Write-Host ""
    Write-Host "======================================"
    Write-Host "LOCAL TASK 2A VERIFICATION: PASS"
    Write-Host "======================================"
}
finally {
    Pop-Location
}
