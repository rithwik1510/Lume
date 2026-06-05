<#
.SYNOPSIS
  One-command release for Lume. Runs every pre-flight gate, then tags, pushes,
  and watches the GitHub Actions release build.

.DESCRIPTION
  Steps, in order (any failure stops the release):
    1. Working tree is clean and on a pushed branch.
    2. The three version manifests agree (package.json, tauri.conf.json, Cargo.toml).
    3. The release tag matches that version and does not already exist.
    4. The signing secrets exist on the repo (TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]).
    5. Tests + typecheck pass.
    6. Confirm, then create + push the tag, which triggers .github/workflows/release.yml.
    7. Watch the run and report the published release.

.PARAMETER DryRun
  Run every check but do NOT create/push the tag.

.EXAMPLE
  ./scripts/release.ps1
  ./scripts/release.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = 'rithwik1510/Workflow'

# Run from the repo root regardless of where the script is invoked from.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg)  { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "  OK  $msg" -ForegroundColor Green }
function Die($msg)   { Write-Host "  FAIL  $msg" -ForegroundColor Red; exit 1 }

# 1. Clean working tree --------------------------------------------------------
Step 'Working tree'
if (git status --porcelain) { Die 'Uncommitted changes. Commit or stash first.' }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
git fetch origin --quiet
$ahead = (git rev-list "origin/$branch..HEAD" 2>$null | Measure-Object).Count
if ($ahead -gt 0) { Die "$ahead local commit(s) not pushed to origin/$branch. Push first." }
Ok "clean, on '$branch', in sync with origin"

# 2. Version consistency -------------------------------------------------------
Step 'Versions'
$pkgVer   = (Get-Content package.json -Raw | ConvertFrom-Json).version
$confVer  = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$cargoVer = (Select-String -Path src-tauri/Cargo.toml -Pattern '^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
if ($pkgVer -ne $confVer -or $pkgVer -ne $cargoVer) {
  Die "Version drift: package.json=$pkgVer tauri.conf.json=$confVer Cargo.toml=$cargoVer"
}
$version = $pkgVer
$tag = "v$version"
Ok "all three manifests = $version"

# 3. Tag availability ----------------------------------------------------------
Step "Tag $tag"
if (git tag --list $tag) { Die "Local tag $tag already exists." }
if (git ls-remote --tags origin $tag) { Die "Remote tag $tag already exists." }
Ok "$tag is free"

# 4. Signing secret present (names only; values are never readable) ------------
# Only TAURI_SIGNING_PRIVATE_KEY is required. The key is passwordless, so the
# _PASSWORD secret may be absent: the workflow's ${{ secrets.* }} reference
# resolves to an empty string when unset, which is exactly what tauri expects.
Step 'Signing secret'
$secrets = (gh secret list -R $repo --json name 2>$null | ConvertFrom-Json).name
if ($secrets -notcontains 'TAURI_SIGNING_PRIVATE_KEY') {
  Die "Missing repo secret 'TAURI_SIGNING_PRIVATE_KEY'. Set it before releasing (see RELEASING.md)."
}
Ok 'TAURI_SIGNING_PRIVATE_KEY present'
if ($secrets -notcontains 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD') {
  Write-Host '  note  _PASSWORD secret absent — fine for a passwordless key (resolves to empty).' -ForegroundColor DarkGray
}

# 5. Tests + typecheck ---------------------------------------------------------
Step 'Tests + typecheck'
npm run typecheck; if ($LASTEXITCODE -ne 0) { Die 'typecheck failed' }
npm test;          if ($LASTEXITCODE -ne 0) { Die 'tests failed' }
Ok 'green'

# 6. Cut the tag ---------------------------------------------------------------
if ($DryRun) {
  Write-Host "`nDry run complete. Everything is ready to release $tag." -ForegroundColor Yellow
  Write-Host "Re-run without -DryRun to tag and publish." -ForegroundColor Yellow
  exit 0
}

Step "Release $tag"
$confirm = Read-Host "Create and push tag $tag to trigger the release build? (y/N)"
if ($confirm -ne 'y') { Write-Host 'Aborted.' -ForegroundColor Yellow; exit 0 }

git tag $tag
git push origin $tag
Ok "pushed $tag"

# 7. Watch the run -------------------------------------------------------------
Step 'Watching release build'
Start-Sleep -Seconds 4
$runId = (gh run list -R $repo --workflow release.yml --limit 1 --json databaseId | ConvertFrom-Json).databaseId
if ($runId) {
  gh run watch $runId -R $repo --exit-status
  if ($LASTEXITCODE -ne 0) { Die 'Release build failed. See the run log above.' }
  Ok 'build succeeded'
  Write-Host "`nRelease published: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
  Write-Host 'Verify the page shows the .exe, its .sig, and latest.json.' -ForegroundColor Green
} else {
  Write-Host 'Could not locate the run; check the Actions tab.' -ForegroundColor Yellow
}
