param(
 [Parameter(Mandatory=$true)][ValidateSet('before','admit','install','migrate','after','reconcile','recover','release')][string]$Phase,
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [Parameter(Mandatory=$true)][string]$SessionId,
 [Parameter(Mandatory=$true)][string]$ReviewFile,
 [string]$ApprovalFile,
 [string]$TestContext,
 [string]$FailAt,
 [string]$ChildFixture,
 [long]$TestClockMs,
 [int]$HoldLockMs,
 [string]$StaleDecisionFile,
 [switch]$InstallAndMigrateApproved,
 [switch]$CoordinatedRecoveryApproved
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$runner=Join-Path $PSScriptRoot 'theme-intent-upgrade-v4.mjs'
$requestPath=[IO.Path]::GetTempFileName()
$oldEncoding=$OutputEncoding
$utf8=New-Object Text.UTF8Encoding($false)
try {
 $request=@{phase=$Phase;evidence=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EvidenceDir);session=$SessionId;review=(Resolve-Path -LiteralPath $ReviewFile).Path}
 if($ApprovalFile){$request.approval=(Resolve-Path -LiteralPath $ApprovalFile).Path}
 if($TestContext){$request.test_context=(Resolve-Path -LiteralPath $TestContext).Path}
 if($FailAt){$request.fail_at=$FailAt}
 if($ChildFixture){$request.child_fixture=(Resolve-Path -LiteralPath $ChildFixture).Path}
 if($TestClockMs){$request.test_clock_ms=$TestClockMs}
 if($HoldLockMs){$request.hold_lock_ms=$HoldLockMs}
 if($StaleDecisionFile){$request.stale_decision=(Resolve-Path -LiteralPath $StaleDecisionFile).Path}
 $request.install_and_migrate_approved=[bool]$InstallAndMigrateApproved
 $request.coordinated_recovery_approved=[bool]$CoordinatedRecoveryApproved
 $request.presecret=$true
 [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Compress),$utf8)
 $presecret=node $runner $requestPath
 if($LASTEXITCODE -ne 0){throw 'Pre-secret review/identity/path/decision checks failed; no credential read.'}
 $gate=$presecret|ConvertFrom-Json
 if(-not $gate.presecret_passed){throw 'Missing pre-secret receipt'}
 if($gate.no_credentials){
  $request.presecret=$false
  [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Compress),$utf8)
  node $runner $requestPath
  if($LASTEXITCODE -ne 0){throw 'Stale-state release refused; preserve evidence.'}
  return
 }
 Add-Type -AssemblyName System.Security
 $blob=[IO.File]::ReadAllBytes($gate.credential_path)
 $entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres')
 $passwordValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $request.presecret=$false
 [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Compress),$utf8)
 $OutputEncoding=$utf8
 @{password=$passwordValue}|ConvertTo-Json -Compress|node $runner $requestPath
 if($LASTEXITCODE -ne 0){throw 'Helper stopped; preserve intents/evidence and use reconcile or explicit recovery.'}
} finally {
 $OutputEncoding=$oldEncoding
 $passwordValue=$null;$blob=$null
 Remove-Item -LiteralPath $requestPath -ErrorAction SilentlyContinue
}
