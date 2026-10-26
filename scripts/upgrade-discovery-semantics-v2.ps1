param([Parameter(Mandatory=$true)][ValidateSet('before','after')][string]$Phase)
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot 'upgrade-discovery-semantics-v2.mjs'
node $runner --check
if($LASTEXITCODE -ne 0){throw 'Static package validation failed before secrets.'}
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/postgres.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres')
 $passwordValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 @{password=$passwordValue}|ConvertTo-Json -Compress|node $runner $Phase
 if($LASTEXITCODE -ne 0){throw 'Upgrade preparation/preservation stopped; inspect evidence, do not repeat blindly.'}
} finally {$passwordValue=$null;$blob=$null}
