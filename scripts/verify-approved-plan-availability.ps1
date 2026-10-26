$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '../tracking/evidence/approved-availability-check-2026-10-22/operation.lock')){throw 'Approved check already started; no repeat.'}
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/session.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:session')
 $text=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $payload=@{session=($text|ConvertFrom-Json)}|ConvertTo-Json -Depth 4 -Compress
 $text=$null
 $payload|node (Join-Path $PSScriptRoot 'verify-approved-plan-availability.mjs') --run-approved-once
 if($LASTEXITCODE -ne 0){throw 'Approved check stopped. Inspect receipts; no retry.'}
} finally {$payload=$null;$text=$null;$blob=$null}
