param(
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [Parameter(Mandatory=$true)][string]$SessionId,
 [Parameter(Mandatory=$true)][string]$ReviewFile,
 [Parameter(Mandatory=$true)][string]$ApprovalFile,
 [switch]$CoordinatedRecoveryApproved,
 [string]$TestContext
)
$ErrorActionPreference='Stop'
if(-not $CoordinatedRecoveryApproved){throw 'Separate exact coordinated recovery approval required.'}
$argsForHelper=@{Phase='recover';EvidenceDir=$EvidenceDir;SessionId=$SessionId;ReviewFile=$ReviewFile;ApprovalFile=$ApprovalFile}
if($TestContext){$argsForHelper.TestContext=$TestContext}
& (Join-Path $PSScriptRoot 'upgrade-theme-intent-v2.ps1') @argsForHelper
