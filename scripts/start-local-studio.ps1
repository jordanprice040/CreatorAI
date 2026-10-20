# Starts the fresh studio adopted on October 20, 2026. No migration or seeding.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$passwordFile = Join-Path (Get-Location) '.env.docker'
if (-not (Test-Path -LiteralPath $passwordFile)) { throw 'Missing private .env.docker configuration.' }
$passwordLine = Get-Content -LiteralPath $passwordFile | Where-Object { $_.StartsWith('CREATOR_DOCKER_PASSWORD=') }
if (@($passwordLine).Count -ne 1) { throw 'Expected one Docker password setting.' }
$studioPassword = $passwordLine.Substring('CREATOR_DOCKER_PASSWORD='.Length)
$env:CREATOR_DATABASE_URL = 'postgresql://creator:' + [Uri]::EscapeDataString($studioPassword) + '@127.0.0.1:55433/creator_studio'
$env:CREATOR_PRODUCTS_ROOT = Join-Path (Get-Location) '.creator/studio/products'
Write-Output 'Starting creator_studio on 127.0.0.1:55433 with .creator/studio/products.'
Write-Output 'The existing Docker database service must be running. Ctrl+C stops the development UI/API.'
node node_modules/typescript/bin/tsc -b
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
node scripts/dev.mjs
