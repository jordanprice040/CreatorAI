param(
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [Parameter(Mandatory=$true)][string]$ApprovalFile,
 [switch]$InstallAndMigrateApproved
)
$ErrorActionPreference='Stop'
if(-not $InstallAndMigrateApproved){throw 'New explicit owner installation and migration approval required.'}
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& (Join-Path $PSScriptRoot 'upgrade-theme-intent.ps1') -Phase admit -EvidenceDir $EvidenceDir -ApprovalFile $ApprovalFile
$plan=Get-Content -Raw -LiteralPath 'tracking/evidence/theme-intent-package-2026-10-23/installation-plan.json' | ConvertFrom-Json
$installer=[IO.Path]::GetFullPath($plan.installer_path)
if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $plan.installer_sha256){throw 'Installer changed after admission'}
$process=Start-Process -FilePath $installer -ArgumentList '/S','/NS' -WindowStyle Hidden -Wait -PassThru
@{at=[DateTime]::UtcNow.ToString('o');exit_code=$process.ExitCode;installer_sha256=$plan.installer_sha256}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $EvidenceDir 'installer-outcome.json') -NoClobber
if($process.ExitCode -ne 0){throw 'Installer failed. Preserve locks; explicit recovery required.'}
& (Join-Path $PSScriptRoot 'upgrade-theme-intent.ps1') -Phase migrate -EvidenceDir $EvidenceDir -ApprovalFile $ApprovalFile
& (Join-Path $PSScriptRoot 'upgrade-theme-intent.ps1') -Phase after -EvidenceDir $EvidenceDir -ApprovalFile $ApprovalFile
