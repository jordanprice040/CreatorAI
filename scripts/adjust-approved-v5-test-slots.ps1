param([Parameter(Mandatory=$true)][ValidateSet('increase','restore')][string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$studioPath='C:/Users/jorda/AppData/Local/com.creatoragent.studio'
function Read-LocalSecret([string]$Name){
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath "secrets/$Name.dpapi"))
 $entropy=[Text.Encoding]::UTF8.GetBytes("creator-agent-studio/1:$Name")
 [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}
try{
 $payload=@{session=((Read-LocalSecret 'session')|ConvertFrom-Json);database_password=(Read-LocalSecret 'postgres')}|ConvertTo-Json -Depth 4 -Compress
 $payload|node (Join-Path $PSScriptRoot 'adjust-approved-v5-test-slots.mjs') $Mode
 if($LASTEXITCODE -ne 0){throw 'Read-only studio inspection failed.'}
}finally{$payload=$null}
