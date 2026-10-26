param([Parameter(Mandatory = $true)][string]$StudioHome)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
function Read-StudioSecret([string]$Name) {
    $blob = [IO.File]::ReadAllBytes((Join-Path $StudioHome "secrets/$Name.dpapi"))
    $entropy = [Text.Encoding]::UTF8.GetBytes("creator-agent-studio/1:$Name")
    return [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser))
}
try {
    $payload = @{session = ((Read-StudioSecret 'session') | ConvertFrom-Json); database_password = (Read-StudioSecret 'postgres')} | ConvertTo-Json -Depth 4 -Compress
    $payload | node (Join-Path $PSScriptRoot 'qualify-plan-summarization.mjs') --run $StudioHome
    if ($LASTEXITCODE -ne 0) { throw 'Qualification stopped. Inspect the saved receipt; do not retry automatically.' }
} finally {
    $payload = $null
}
