param(
    [Parameter(Mandatory=$true)][string]$BaselineInstaller,
    [Parameter(Mandatory=$true)][string]$UpgradeInstaller
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destination = [IO.Path]::GetFullPath((Join-Path $workspace '.verification/x05 installed client'))
if (-not $destination.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar)) { throw 'Install target escapes workspace' }
$product = 'Creator Agent X05 Acceptance'
$registry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
if ((Test-Path -LiteralPath $registry) -or (Test-Path -LiteralPath $destination)) { throw 'Acceptance identity or destination already exists; inspect before retrying' }
$baseline = (Resolve-Path -LiteralPath $BaselineInstaller).Path
$upgrade = (Resolve-Path -LiteralPath $UpgradeInstaller).Path
if ([IO.Path]::GetFileName($baseline) -ne "$($product)_0.1.0_x64-setup.exe") { throw 'Only the separately named baseline fixture is accepted' }
if ([IO.Path]::GetFileName($upgrade) -ne "$($product)_0.1.1_x64-setup.exe") { throw 'Only the separately named upgrade fixture is accepted' }
$evidence = Join-Path $workspace 'tracking/evidence/x05'
$steps = [Collections.Generic.List[object]]::new()
function Run-Installer([string]$path) {
    # NSIS /D must be last and unquoted; Start-Process passes this as one argument line.
    $process = Start-Process -FilePath $path -ArgumentList "/S /NS /D=$destination" -WindowStyle Hidden -Wait -PassThru
    Write-Host "Installer $([IO.Path]::GetFileName($path)): exit $($process.ExitCode)"
    return $process.ExitCode
}
function Assert-Version([string]$expected) {
    $actual = (Get-ItemProperty -LiteralPath $registry).DisplayVersion
    if ($actual -ne $expected) { throw "Expected installed version $expected, observed $actual" }
}
function Probe([string]$label) {
    $env:CREATOR_NATIVE_EXECUTABLE = Join-Path $destination 'creator-desktop.exe'
    try {
        & node (Join-Path $PSScriptRoot 'native-startup.mjs') *> (Join-Path $evidence "installed-$label-startup.log")
        if ($LASTEXITCODE -ne 0) { throw "Installed $label startup probe failed" }
    } finally { Remove-Item Env:CREATOR_NATIVE_EXECUTABLE -ErrorAction SilentlyContinue }
    # WebView shutdown can outlive navigation/exit observation; wait for write access
    # before asking NSIS to replace this exact executable.
    $until = (Get-Date).AddSeconds(10)
    $lockedObservations = 0
    while ($true) {
        try {
            $file = [IO.File]::Open((Join-Path $destination 'creator-desktop.exe'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $file.Dispose()
            break
        } catch {
            $lockedObservations++
            if ((Get-Date) -ge $until) { throw 'Native probe left the installed executable locked' }
            Start-Sleep -Milliseconds 100
        }
    }
    Write-Host "Installed $label startup complete; locked observations before replacement: $lockedObservations"
}
function Uninstall-Fixture {
    $uninstaller = Join-Path $destination 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Missing acceptance uninstaller; preserve installed files for inspection' }
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Fixture uninstall failed: $($process.ExitCode)" }
    $until = (Get-Date).AddSeconds(20)
    while (((Test-Path -LiteralPath $registry) -or (Test-Path -LiteralPath (Join-Path $destination 'creator-desktop.exe'))) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 100 }
    if ((Test-Path -LiteralPath $registry) -or (Test-Path -LiteralPath (Join-Path $destination 'creator-desktop.exe'))) { throw 'Fixture uninstall did not remove registration and executable' }
}
try {
    $code = Run-Installer $baseline
    if ($code -ne 0) { throw "Baseline install failed: $code" }
    Assert-Version '0.1.0'; Probe 'baseline'
    $steps.Add(@{ step='install'; version='0.1.0'; startup=$true })
    $code = Run-Installer $upgrade
    if ($code -ne 0) { throw "Upgrade failed: $code" }
    Assert-Version '0.1.1'; Probe 'upgrade'
    $steps.Add(@{ step='upgrade'; version='0.1.1'; startup=$true })
    $before = (Get-FileHash -LiteralPath (Join-Path $destination 'creator-desktop.exe') -Algorithm SHA256).Hash
    $code = Run-Installer $baseline
    if ($code -eq 0) { throw 'Silent downgrade unexpectedly succeeded' }
    Assert-Version '0.1.1'
    if ($before -ne (Get-FileHash -LiteralPath (Join-Path $destination 'creator-desktop.exe') -Algorithm SHA256).Hash) { throw 'Refused downgrade changed executable' }
    $steps.Add(@{ step='downgrade_refused'; exit_code=$code; executable_unchanged=$true })
    Uninstall-Fixture
    $code = Run-Installer $baseline
    if ($code -ne 0) { throw "Explicit reinstall rollback failed: $code" }
    Assert-Version '0.1.0'; Probe 'rollback'
    $steps.Add(@{ step='explicit_uninstall_reinstall_rollback'; version='0.1.0'; startup=$true })
} finally {
    if (Test-Path -LiteralPath $registry) { Uninstall-Fixture }
}
@{
    at=[DateTime]::UtcNow.ToString('o'); state='fixture_installer_lifecycle_verified'; fixture=$true; debug_build=$true
    product=$product; destination=$destination; steps=$steps; fixture_uninstalled=$true
    installers=@(@{ path=$baseline; sha256=(Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash }, @{ path=$upgrade; sha256=(Get-FileHash -LiteralPath $upgrade -Algorithm SHA256).Hash })
    limitations=@('Unsigned debug installers under separate acceptance identity; not production signing acceptance.', 'Manual NSIS upgrade/rollback only; automatic updater is disabled.', 'Existing WebView2 and separately running local API/UI are prerequisites.', 'Startup is real WebView navigation, not rendered UI/editor acceptance.')
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'windows-installer-acceptance.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $evidence 'windows-installer-acceptance.json')
