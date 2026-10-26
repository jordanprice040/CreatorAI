$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
$blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/postgres.dpapi'))
$entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres')
try {
 $secretValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 @{home=$studioPath;password=$secretValue}|ConvertTo-Json -Compress|node (Join-Path $PSScriptRoot 'execute-approved-discovery-upgrade.mjs')
 if($LASTEXITCODE -ne 0){throw 'Approved migration stopped; inspect state before further action.'}
}finally{$secretValue=$null}
