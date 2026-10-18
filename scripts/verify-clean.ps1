$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$candidateRoot = Join-Path $repoRoot ('.verification/t01-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
if (-not ([IO.Path]::GetFullPath($candidateRoot).StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) { throw 'Verification path escaped repository.' }
if (Test-Path -LiteralPath $candidateRoot) { throw 'Refusing to overwrite an existing verification directory.' }
New-Item -ItemType Directory -Path $candidateRoot | Out-Null
Push-Location $repoRoot
try {
    $files = @(rg --files --hidden apps packages tests scripts config docs templates)
    if ($LASTEXITCODE -ne 0) { throw 'Source enumeration failed.' }
    $files += @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', '.npmrc', '.prettierrc.json', '.prettierignore', '.gitignore', '.node-version')
    foreach ($file in $files) {
        $destination = Join-Path $candidateRoot $file
        New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $destination
    }
    Set-Location -LiteralPath $candidateRoot
    Write-Output "Clean candidate: $candidateRoot"
    if (Test-Path node_modules) { throw 'Candidate was not clean.' }
    pnpm install --frozen-lockfile --offline
    if ($LASTEXITCODE -ne 0) { throw 'Clean frozen install failed.' }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Clean build failed.' }
    pnpm check
    if ($LASTEXITCODE -ne 0) { throw 'Clean checks failed.' }
    Write-Output 'PASS: fresh source-only directory, frozen offline-cache install, build, typecheck, tests and formatting.'
} finally {
    Pop-Location
}
