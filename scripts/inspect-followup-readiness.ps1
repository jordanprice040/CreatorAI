$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
$payload=$null
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/session.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:session')
 $sessionText=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $payload=@{session=($sessionText|ConvertFrom-Json)}|ConvertTo-Json -Depth 4 -Compress
 $sessionText=$null
 $payload|node (Join-Path $PSScriptRoot 'inspect-followup-readiness.mjs')
 if($LASTEXITCODE -ne 0){throw 'Read-only studio status inspection failed; no provider fallback.'}
} finally {$payload=$null;$sessionText=$null;$blob=$null}
