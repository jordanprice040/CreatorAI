param(
 [Parameter(Mandatory=$true)][ValidateSet('before','admit','migrate','after')][string]$Phase,
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [string]$ApprovalFile
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$runner=Join-Path $PSScriptRoot 'upgrade-theme-intent.mjs'
node $runner $Phase $EvidenceDir $ApprovalFile --presecret
if($LASTEXITCODE -ne 0){throw 'Pre-secret checks failed; no credential access.'}
Add-Type -AssemblyName System.Security
try {
 $blob=[IO.File]::ReadAllBytes('C:/Users/jorda/AppData/Local/com.creatoragent.studio/secrets/postgres.dpapi')
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres')
 $passwordValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 @{password=$passwordValue}|ConvertTo-Json -Compress|node $runner $Phase $EvidenceDir $ApprovalFile
 if($LASTEXITCODE -ne 0){throw 'Upgrade helper stopped. Preserve evidence and locks; do not retry mutation blindly.'}
} finally {$passwordValue=$null;$blob=$null}
