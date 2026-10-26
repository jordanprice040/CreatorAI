$ErrorActionPreference='Stop'
$rootPath=Split-Path -Parent $PSScriptRoot
$planPath=Join-Path $rootPath 'tracking/evidence/discovery-semantics-v2-package/installation-plan.json'
$installPlan=Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$preparedPath=Join-Path $rootPath 'tracking/evidence/discovery-semantics-v2-installation/prepared.json'
$prepared=Get-Content -LiteralPath $preparedPath -Raw | ConvertFrom-Json
if(-not $prepared.backup_verified){throw 'Verified backup required'}
$backupRecord=Get-Content -LiteralPath (Join-Path $rootPath 'tracking/evidence/discovery-semantics-v2-installation/backup.json') -Raw | ConvertFrom-Json
$dumpPath=Join-Path $backupRecord.dir 'database.dump'
if((Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $backupRecord.database.database.sha256){throw 'Database backup hash mismatch'}
foreach($productFile in $backupRecord.database.products){$productPath=Join-Path (Join-Path $backupRecord.dir 'products') $productFile.path;if((Get-FileHash -LiteralPath $productPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $productFile.sha256){throw 'Product backup changed'}}
$rollback=Get-Content -LiteralPath (Join-Path $rootPath 'tracking/evidence/discovery-semantics-v2-installation/program-rollback.json') -Raw | ConvertFrom-Json
foreach($fileRecord in $rollback.files.PSObject.Properties){if((Get-FileHash -LiteralPath (Join-Path $rollback.dir $fileRecord.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $fileRecord.Value){throw 'Program rollback changed'}}
if(Get-Process creator-desktop -ErrorAction SilentlyContinue){throw 'Quit Creator Agent fully before installation.'}
$installerPath=[IO.Path]::GetFullPath((Join-Path $rootPath $installPlan.installer_path))
if(-not $installerPath.StartsWith((Join-Path $rootPath '.verification/discovery-semantics-v2-artifacts'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected installer path'}
if((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $installPlan.installer_sha256){throw 'Pinned installer changed'}
$previousManifest=Join-Path $installPlan.target_install_dir 'studio/bundle-manifest.json'
if((Get-FileHash -LiteralPath $previousManifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $installPlan.expected_predecessor_manifest_sha256){throw 'Installed predecessor changed'}
$receiptPath=Join-Path $rootPath 'tracking/evidence/discovery-semantics-v2-installation/installer-outcome.json'
$lockPath=Join-Path $rootPath 'tracking/evidence/discovery-semantics-v2-installation/installer.lock'
$lockStream=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$lockStream.Dispose()
$installedProcess=Start-Process -FilePath $installerPath -ArgumentList '/S','/NS' -WindowStyle Hidden -Wait -PassThru
@{at=[DateTime]::UtcNow.ToString('o');exit_code=$installedProcess.ExitCode;installer_sha256=$installPlan.installer_sha256;provider_calls=0}|ConvertTo-Json|Set-Content -LiteralPath $receiptPath
if($installedProcess.ExitCode -ne 0){throw 'Installer failed; preserve evidence and do not repeat blindly.'}
'Pinned installer completed; before/after integrity and health checks still required.'
