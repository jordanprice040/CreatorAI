param([string]$OutputPath = 'tracking/evidence/t00/local-baseline.json')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Push-Location $root
try {
    $files = @(rg --files --hidden -g '!.git/**')
    if ($LASTEXITCODE -ne 0) { throw 'File inventory failed.' }
    $jsonResults = @(Get-ChildItem -LiteralPath templates -Filter '*.json' | ForEach-Object {
        $null = Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json
        [ordered]@{ path = 'templates/' + $_.Name; parses = $true }
    })
    $original = Get-Content -Raw tracking/evidence/t00/input-kit-hashes.json | ConvertFrom-Json
    $changes = @($original.files | ForEach-Object {
        $actual = (Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $_.actual_sha256) { $_.path }
    })
    $tools = @('git', 'node', 'pnpm', 'npm', 'python', 'gh', 'docker', 'psql', 'temporal')
    $toolPaths = @($tools | ForEach-Object {
        $found = Get-Command $_ -ErrorAction SilentlyContinue | Select-Object -First 1
        [ordered]@{ name = $_; on_path = ($null -ne $found); path = $found.Source }
    })
    $versions = [ordered]@{}
    foreach ($name in @('git', 'node', 'pnpm', 'npm', 'python', 'gh')) {
        $value = @(& $name --version 2>&1 | ForEach-Object { $_.ToString() })
        $code = $LASTEXITCODE
        $versions[$name] = [ordered]@{ output = $value; exit_code = $code }
        if ($code -ne 0) { throw "$name version check failed." }
    }
    git rev-parse --verify HEAD 2>$null | Out-Null
    $headExists = ($LASTEXITCODE -eq 0)
    $result = [ordered]@{
        observed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        root = $root
        powershell_version = $PSVersionTable.PSVersion.ToString()
        os = [Environment]::OSVersion.VersionString
        verifier_sha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
        branch = (git symbolic-ref --short HEAD)
        head_exists = $headExists
        remotes = @(git remote -v)
        tracked_files = @(git ls-files)
        status = @(git status --short --branch)
        files_excluding_git = $files
        package_and_lockfiles = @($files | Where-Object { $_ -match '(^|[\\/])(package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|pyproject\.toml|requirements[^\\/]*\.txt|Cargo\.toml|go\.mod|CMakeLists\.txt)$' })
        application_paths_present = @(@('apps', 'packages', 'src', 'tests', '.github/workflows') | Where-Object { Test-Path -LiteralPath $_ })
        template_json_checks = $jsonResults
        changed_since_supplied_kit_snapshot = $changes
        tools = $toolPaths
        versions = $versions
        scope = 'Documentation and environment baseline only; JSON parsing is not schema validation. No application, provider, service, browser, or CI tests exist or were run.'
    }
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
    Write-Output "Saved $OutputPath; $($jsonResults.Count) JSON templates parsed; $($changes.Count) original kit files changed."
} finally {
    Pop-Location
}
