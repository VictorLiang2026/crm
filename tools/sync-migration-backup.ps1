# Sync migration dual-backup: cloudbase/migrations -> C:\Users\victor\cloudbase\migrations
# Non-destructive: external-only or divergent files are moved to an _archive-<date> folder first.
# Run OUTSIDE the TRAE sandbox (normal PowerShell) because the external backup path is not in its writable list:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-migration-backup.ps1
# Rule basis: docs/开发安全边界说明.md 一.3 (migration dual backup); execution-contract E.
param(
  [string]$External = (Join-Path $env:USERPROFILE 'cloudbase\migrations'),
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$local = Join-Path $root 'cloudbase\migrations'
if (!(Test-Path -LiteralPath $local)) { throw "Local migrations folder not found: $local" }
if (!(Test-Path -LiteralPath $External)) { throw "External backup folder not found: $External" }
$archive = Join-Path $External ('_archive-' + (Get-Date -Format 'yyyyMMdd'))
$localFiles = @{}
Get-ChildItem -LiteralPath $local -File | ForEach-Object { $localFiles[$_.Name] = $_.FullName }
$toArchive = @()
Get-ChildItem -LiteralPath $External -File | ForEach-Object {
  if (-not $localFiles.ContainsKey($_.Name)) { $toArchive += $_ }
  elseif ((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath $localFiles[$_.Name]).Hash) { $toArchive += $_ }
}
Write-Host ("Local files: {0}; external files: {1}; to archive (old/divergent): {2}" -f $localFiles.Count, (Get-ChildItem -LiteralPath $External -File).Count, $toArchive.Count)
if ($toArchive.Count) {
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $archive | Out-Null }
  foreach ($f in $toArchive) {
    if ($DryRun) { Write-Host "[dry-run] would archive: $($f.Name)" }
    else { Move-Item -LiteralPath $f.FullName -Destination (Join-Path $archive $f.Name) -Force; Write-Host "archived: $($f.Name)" }
  }
}
if ($DryRun) {
  Get-ChildItem -LiteralPath $local -File | ForEach-Object {
    $dst = Join-Path $External $_.Name
    if (-not (Test-Path -LiteralPath $dst)) { Write-Host "[dry-run] would copy (new): $($_.Name)" }
    elseif ((Get-FileHash -LiteralPath $dst).Hash -ne (Get-FileHash -LiteralPath $_.FullName).Hash) { Write-Host "[dry-run] would copy (update): $($_.Name)" }
  }
  Write-Host '[dry-run] no changes made.'
  return
}
Copy-Item -Path (Join-Path $local '*') -Destination $External -Force
# Verify every local file exists externally with identical hash.
$mismatch = 0
foreach ($name in $localFiles.Keys) {
  $dst = Join-Path $External $name
  if (-not (Test-Path -LiteralPath $dst) -or (Get-FileHash -LiteralPath $dst).Hash -ne (Get-FileHash -LiteralPath $localFiles[$name]).Hash) { $mismatch++ }
}
if ($mismatch) { throw "Backup verification failed: $mismatch file(s) missing or different after copy." }
Write-Host ("[PASS] External backup matches local: {0} files. Old drafts kept in {1}." -f $localFiles.Count, $archive)
