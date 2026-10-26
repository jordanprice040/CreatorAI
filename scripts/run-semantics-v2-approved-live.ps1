param([Parameter(Mandatory=$true)][string]$ApprovedAuthorizationHash,[Parameter(Mandatory=$true)][string]$AuthorizationReviewReceipt)
$ErrorActionPreference='Stop'
node (Join-Path $PSScriptRoot 'check-semantics-live-authorization.mjs') --approval-check $ApprovedAuthorizationHash $AuthorizationReviewReceipt
if($LASTEXITCODE -ne 0){throw 'Static authorization/installation/review gate failed before secrets.'}
$evidencePath=Join-Path $PSScriptRoot '../tracking/evidence/discovery-semantics-v2-live-authorization'
$combined=Get-Content -LiteralPath (Join-Path $evidencePath 'authorization-plan.json') -Raw|ConvertFrom-Json
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '../tracking/evidence/discovery-semantics-v2-runner/run.lock')){throw 'Suite has already started; no resumption.'}
$operationLock=[IO.File]::Open((Join-Path $evidencePath 'operation.lock'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$operationLock.Dispose()
Add-Type -AssemblyName System.Security
$studioPath=$combined.studio_home
try {
 $blob=[IO.File]::ReadAllBytes((Join-Path $studioPath 'secrets/session.dpapi'))
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:session')
 $sessionValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $payload=@{session=($sessionValue|ConvertFrom-Json)}|ConvertTo-Json -Depth 4 -Compress
 $payload|node (Join-Path $PSScriptRoot 'recheck-semantics-v2-availability.mjs') --run-approved-once $combined.availability_plan_hash
 if($LASTEXITCODE -ne 0){throw 'Availability check stopped; do not retry or start suite.'}
} finally {$payload=$null;$blob=$null;$sessionValue=$null}
$probeResult=Get-Content -LiteralPath (Join-Path $evidencePath 'availability/result.json') -Raw|ConvertFrom-Json
if(-not $probeResult.available -or $probeResult.new_requests -ne 1 -or $probeResult.remaining_daily_requests -lt 12){throw 'Availability/capacity not established; no suite.'}
& (Join-Path $PSScriptRoot 'qualify-discovery-semantics-v2.ps1') -StudioHome $studioPath -ApprovedExecutionPlanHash $combined.suite_execution_plan_hash -SeparateReviewReceipt $combined.suite_review_receipt -InstallationReceipt $combined.installation_receipt
if($LASTEXITCODE -ne 0){throw 'Suite stopped; preserve all locks/evidence, no retry.'}
