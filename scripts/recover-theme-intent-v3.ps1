param(
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [Parameter(Mandatory=$true)][string]$SessionId,
 [Parameter(Mandatory=$true)][string]$ReviewFile,
 [Parameter(Mandatory=$true)][string]$ApprovalFile,
 [switch]$CoordinatedRecoveryApproved,
 [string]$TestContext,
 [string]$StaleDecisionFile
)
$ErrorActionPreference='Stop'
if(-not $CoordinatedRecoveryApproved){throw 'Separate exact coordinated recovery approval required.'}
$argsForHelper=@{Phase='recover';EvidenceDir=$EvidenceDir;SessionId=$SessionId;ReviewFile=$ReviewFile;ApprovalFile=$ApprovalFile;CoordinatedRecoveryApproved=$true}
if($TestContext){$argsForHelper.TestContext=$TestContext}
if($StaleDecisionFile){$argsForHelper.StaleDecisionFile=$StaleDecisionFile}
& (Join-Path $PSScriptRoot 'upgrade-theme-intent-v3.ps1') @argsForHelper
