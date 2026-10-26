param([Parameter(Mandatory=$true)][ValidateSet('before','migrate','after')][string]$Phase)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/postgres.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres')
 $passwordValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 @{password=$passwordValue}|ConvertTo-Json -Compress|node (Join-Path $PSScriptRoot 'availability-recheck-upgrade.mjs') $Phase
 if($LASTEXITCODE -ne 0){throw 'Upgrade phase stopped; inspect evidence before proceeding.'}
} finally {$passwordValue=$null;$blob=$null}
