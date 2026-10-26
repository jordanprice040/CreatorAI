param(
 [Parameter(Mandatory=$true)][string]$StudioHome,
 [Parameter(Mandatory=$true)][string]$ApprovedExecutionPlanHash
)
$ErrorActionPreference='Stop'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../tracking/evidence/discovery-qualification-v3/run.lock')) { throw 'This frozen run has already started; do not repeat it.' }
Add-Type -AssemblyName System.Security
function Read-StudioSecret([string]$Name) {
 $blob=[IO.File]::ReadAllBytes((Join-Path $StudioHome "secrets/$Name.dpapi"))
 $entropy=[Text.Encoding]::UTF8.GetBytes("creator-agent-studio/1:$Name")
 [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}
try {
 $payload=@{session=((Read-StudioSecret 'session')|ConvertFrom-Json);database_password=(Read-StudioSecret 'postgres')}|ConvertTo-Json -Depth 4 -Compress
 $payload|node (Join-Path $PSScriptRoot 'qualify-plan-discovery-v3.mjs') --run $StudioHome $ApprovedExecutionPlanHash
 if($LASTEXITCODE -ne 0){throw 'Qualification stopped; inspect receipts without deleting run.lock or retrying.'}
} finally {$payload=$null}
