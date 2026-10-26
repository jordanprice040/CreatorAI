param(
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [Parameter(Mandatory=$true)][string]$SessionId,
 [Parameter(Mandatory=$true)][string]$ReviewFile,
 [Parameter(Mandatory=$true)][string]$ApprovalFile,
 [switch]$InstallAndMigrateApproved,
 [string]$TestContext,
 [string]$FailAt,
 [string]$ChildFixture,
 [long]$TestClockMs
)
$ErrorActionPreference='Stop'
if(-not $InstallAndMigrateApproved){throw 'New exact installation/migration approval required.'}
$argsForHelper=@{Phase='install';EvidenceDir=$EvidenceDir;SessionId=$SessionId;ReviewFile=$ReviewFile;ApprovalFile=$ApprovalFile}
if($TestContext){$argsForHelper.TestContext=$TestContext}
if($FailAt){$argsForHelper.FailAt=$FailAt}
if($ChildFixture){$argsForHelper.ChildFixture=$ChildFixture}
if($TestClockMs){$argsForHelper.TestClockMs=$TestClockMs}
& (Join-Path $PSScriptRoot 'upgrade-theme-intent-v2.ps1') @argsForHelper
