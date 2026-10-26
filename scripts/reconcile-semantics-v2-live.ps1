$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/postgres.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres')
 $passwordValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 @{password=$passwordValue}|ConvertTo-Json -Compress|node (Join-Path $PSScriptRoot 'reconcile-semantics-v2-live.mjs')
 if($LASTEXITCODE -ne 0){throw 'Read-only reconciliation failed; no retry/provider fallback.'}
}finally{$passwordValue=$null;$blob=$null}
