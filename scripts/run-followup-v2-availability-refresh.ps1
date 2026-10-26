$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '../tracking/evidence/followup-v2-availability-refresh/operation.lock')){throw 'This approved operation already started. No repeat.'}
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/session.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:session')
 $sessionText=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $payload=@{session=($sessionText|ConvertFrom-Json)}|ConvertTo-Json -Depth 4 -Compress
 $sessionText=$null
 $payload|node (Join-Path $PSScriptRoot 'run-followup-v2-availability-refresh.mjs') --run-approved-once
 if($LASTEXITCODE -ne 0){throw 'Recheck stopped; inspect evidence, no retry.'}
} finally {$payload=$null;$sessionText=$null;$blob=$null}
