param([string]$InstallDir,[string]$Payload,[string]$Previous)
$ErrorActionPreference='Stop'
# Fixture only: copy the exact payload; never execute NSIS or modify registry/shortcuts.
Copy-Item -LiteralPath (Join-Path $Payload 'studio') -Destination $InstallDir -Recurse -Force
$native=Join-Path $Payload 'creator-desktop.exe'
if($Previous -eq 'true'){$native=Join-Path $Payload 'packaged-creator-desktop.exe'}
Copy-Item -LiteralPath $native -Destination (Join-Path $InstallDir 'creator-desktop.exe') -Force
