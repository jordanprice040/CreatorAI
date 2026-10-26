param(
 [Parameter(Mandatory=$true)][string]$StudioHome,
 [Parameter(Mandatory=$true)][string]$ApprovedExecutionPlanHash,
 [Parameter(Mandatory=$true)][string]$SeparateReviewReceipt,
 [Parameter(Mandatory=$true)][string]$InstallationReceipt
)
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot 'qualify-discovery-semantics-v2.mjs'
# Static gate before reading DPAPI secrets. This does not contact the studio.
node $runner --execution-check $StudioHome $ApprovedExecutionPlanHash $SeparateReviewReceipt $InstallationReceipt
if($LASTEXITCODE -ne 0){throw 'Static review/plan gate failed; no secrets were read.'}
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '../tracking/evidence/discovery-semantics-v2-runner/run.lock')){throw 'This frozen suite has started. Never delete the lock or resume it.'}
Add-Type -AssemblyName System.Security
function Read-StudioSecret([string]$Name) {
 $blob=[IO.File]::ReadAllBytes((Join-Path $StudioHome "secrets/$Name.dpapi"))
 $entropy=[Text.Encoding]::UTF8.GetBytes("creator-agent-studio/1:$Name")
 [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}
try {
 $payload=@{session=((Read-StudioSecret 'session')|ConvertFrom-Json);database_password=(Read-StudioSecret 'postgres')}|ConvertTo-Json -Depth 4 -Compress
 $payload|node $runner --run $StudioHome $ApprovedExecutionPlanHash $SeparateReviewReceipt $InstallationReceipt
 if($LASTEXITCODE -ne 0){throw 'Stopped: inspect receipts and saved state; do not retry or remove the lock.'}
} finally {$payload=$null}
