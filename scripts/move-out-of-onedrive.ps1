# Moves the Creator Agent development checkout and its local private data out of OneDrive
# (owner decision R1, 2026-10-20), then proves the new location works and that a backup
# restores. It never deletes or changes the old checkout; retiring it is a separate, manual
# step once you are satisfied. Windows PowerShell 5.1 compatible.
#
#   cd C:\Users\jorda\OneDrive\Desktop\creator_agent
#   powershell -ExecutionPolicy Bypass -File scripts\move-out-of-onedrive.ps1
#
# Defaults: new checkout C:\dev\creator_agent, backups C:\CreatorAgentBackups. Override with
# -Target and -BackupRoot. Neither may be inside OneDrive. Start Docker Desktop and the
# database first (docs/BACKUP_AND_RESTORE.md, compose service "db").
param(
    [string]$Source = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$Target = 'C:\dev\creator_agent',
    [string]$BackupRoot = 'C:\CreatorAgentBackups'
)
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Output ''; Write-Output "== $text" }
function Full($path) { [IO.Path]::GetFullPath($path).TrimEnd('\') }
function Under($path, $root) {
    if (-not $root) { return $false }
    $p = (Full $path) + '\'
    $r = (Full $root) + '\'
    return $p.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)
}
function Run($what) {
    & $what[0] $what[1..($what.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "Failed: $($what -join ' ')" }
}

# Every synced root on this machine (personal and work OneDrive).
$synced = @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial) | Where-Object { $_ } | Select-Object -Unique
$Source = Full $Source
$Target = Full $Target
$BackupRoot = Full $BackupRoot

Step 'Checking locations and tools'
foreach ($root in $synced) {
    if (Under $Target $root) { throw "Target $Target is inside OneDrive ($root)." }
    if (Under $BackupRoot $root) { throw "Backup folder $BackupRoot is inside OneDrive ($root)." }
}
if (-not (Test-Path -LiteralPath (Join-Path $Source '.git'))) { throw "$Source is not a Git checkout." }
if ((Test-Path -LiteralPath $Target) -and @(Get-ChildItem -LiteralPath $Target -Force).Count -gt 0) {
    throw "Target $Target already exists and is not empty; choose another or empty it yourself."
}
foreach ($tool in 'git', 'corepack', 'docker', 'node') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}

Push-Location -LiteralPath $Source
try {
    Step 'Checking the old checkout for unsaved work'
    $dirty = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
    if ($dirty.Count -gt 0) {
        $dirty | Select-Object -First 20 | ForEach-Object { Write-Output "  $_" }
        throw 'The old checkout has uncommitted changes. Commit or stash them, then run this again.'
    }
    $origin = (git remote get-url origin).Trim()
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    $stashes = @(git stash list)

    # Ignored local files that matter: .env files, .creator (products, CLI session), private
    # study inputs. Build output and caches are rebuilt instead of copied.
    $skip = '^(node_modules|dist|\.pnpm-store|\.verification)(/|$)|/(node_modules|dist)/|\.tsbuildinfo$'
    $private = @(git ls-files --others --ignored --exclude-standard) | Where-Object { $_ -and $_ -notmatch $skip }
    if ($LASTEXITCODE -ne 0) { throw 'Listing ignored files failed.' }
} finally {
    Pop-Location
}

Step "Cloning into $Target (all local branches)"
New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
Run @('git', 'clone', '--no-local', $Source, $Target)
Push-Location -LiteralPath $Target
try {
    foreach ($ref in @(git -C $Source for-each-ref --format='%(refname:short)' refs/heads)) {
        if ($ref -ne $branch) { Run @('git', 'branch', '--track', $ref, "origin/$ref") }
    }
    Run @('git', 'remote', 'set-url', 'origin', $origin)
    Run @('git', 'checkout', $branch)

    Step "Saving $($stashes.Count) stash entr(ies) as patches"
    # Stashes are not cloned. Each becomes a patch; apply one with: git apply <file>
    $patches = Join-Path $Target '.creator\moved-stashes'
    for ($i = 0; $i -lt $stashes.Count; $i++) {
        New-Item -ItemType Directory -Force -Path $patches | Out-Null
        $file = Join-Path $patches "stash-$i.patch"
        $patch = git -C $Source stash show -p --include-untracked --binary "stash@{$i}"
        if ($LASTEXITCODE -ne 0) { throw "Exporting stash@{$i} failed." }
        [IO.File]::WriteAllLines($file, [string[]]$patch)
        Write-Output "  $($stashes[$i]) -> $file"
    }

    Step "Copying $($private.Count) private local file(s)"
    $copied = 0
    foreach ($rel in $private) {
        $from = Join-Path $Source $rel
        $to = Join-Path $Target $rel
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
        New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
        Copy-Item -LiteralPath $from -Destination $to
        if ((Get-FileHash -LiteralPath $from).Hash -ne (Get-FileHash -LiteralPath $to).Hash) { throw "Copy of $rel does not match." }
        $copied++
    }
    Write-Output "  $copied file(s) copied and hash-checked (names not printed)."

    Step 'Installing and building in the new location'
    Run @('corepack', 'pnpm', 'install', '--frozen-lockfile')
    Run @('corepack', 'pnpm', '-s', 'build:code')

    Step 'Connecting to the Docker database (same volume as before)'
    $envFile = Join-Path $Target '.env.docker'
    if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.docker was not found; it should have been copied.' }
    $password = (Get-Content -LiteralPath $envFile -Raw).Trim().Substring('CREATOR_DOCKER_PASSWORD='.Length)
    $env:CREATOR_DOCKER_PASSWORD = $password
    Run @('docker', 'compose', '--env-file', '.env.docker', 'up', '-d', '--wait', 'db')
    $env:CREATOR_DATABASE_URL = "postgresql://creator:$password@127.0.0.1:55433/creator_dev"
    $env:CREATOR_PRODUCTS_ROOT = Join-Path $Target '.creator\products'
    New-Item -ItemType Directory -Force -Path $env:CREATOR_PRODUCTS_ROOT | Out-Null
    Run @('corepack', 'pnpm', 'backup', 'verify')

    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    $backup = Join-Path $BackupRoot $stamp
    Step "Taking a backup to $backup"
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    Run @('corepack', 'pnpm', 'backup', 'create', $backup)

    Step 'Proving the backup restores into an empty database'
    $check = "creator_restore_check_$stamp".Replace('-', '_')
    $restoredProducts = Join-Path $BackupRoot "restore-check-$stamp"
    Run @('docker', 'compose', '--env-file', '.env.docker', 'exec', '-T', 'db', 'psql', '-U', 'creator', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', "create database $check")
    try {
        $env:CREATOR_DATABASE_URL = "postgresql://creator:$password@127.0.0.1:55433/$check"
        $env:CREATOR_PRODUCTS_ROOT = $restoredProducts
        Run @('corepack', 'pnpm', 'backup', 'restore', $backup)
        Run @('corepack', 'pnpm', 'backup', 'verify')
        Write-Output "  Restore check passed: $check matches the backup."
    } finally {
        $env:CREATOR_DATABASE_URL = "postgresql://creator:$password@127.0.0.1:55433/creator_dev"
        $env:CREATOR_PRODUCTS_ROOT = Join-Path $Target '.creator\products'
        docker compose --env-file .env.docker exec -T db psql -U creator -d postgres -c "drop database if exists $check" | Out-Null
        if (Test-Path -LiteralPath $restoredProducts) { Remove-Item -LiteralPath $restoredProducts -Recurse -Force }
    }
} finally {
    Pop-Location
}

Step 'Done. The old checkout was not changed.'
Write-Output "New checkout:  $Target (branch $branch)"
Write-Output "Backup:        $backup (verified by a restore into a scratch database, now dropped)"
Write-Output "Next: work from $Target for a while. When you are satisfied, retire the old folder:"
Write-Output "  1. In $Source run 'git status' and 'git log --branches --not --remotes' (should be empty)."
Write-Output "  2. Delete $Source yourself, then empty it from the OneDrive recycle bin online,"
Write-Output "     because OneDrive keeps copies of the .env files, session and products it synced."
Write-Output 'Keep backups out of OneDrive. Copy them to an external drive if you want an off-machine copy.'
