# Deploy changed cloud artifacts BEFORE this command. This script publishes Git only.
param([Parameter(Mandatory=$true)][string]$Message, [string]$Tag = ('release-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function GitChecked([string[]]$Arguments) {
  $result = & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed." }
  return $result
}
try {
  if ($Tag -notmatch '^(v\d+(\.\d+){2,3}|release-\d{8}-\d{4,6})$') { throw 'Invalid release tag.' }
  if ((GitChecked @('branch','--show-current')) -ne 'master') { throw 'Switch/merge to master before release.' }
  $origin = GitChecked @('remote','get-url','origin')
  if ($origin -notin @('https://github.com/VictorLiang2026/crm.git','git@github.com:VictorLiang2026/crm.git')) { throw 'Unexpected GitHub remote.' }
  $existing = @(GitChecked @('tag','-l',$Tag))
  $remoteTag = @(GitChecked @('ls-remote','--tags','origin',"refs/tags/$Tag"))
  if ($existing.Count -or $remoteTag.Count) { throw 'Tag exists; use a new release tag.' }
  GitChecked @('fetch','origin','master') | Out-Host
  GitChecked @('merge-base','--is-ancestor','origin/master','HEAD') | Out-Null
  # A failed cloud check prevents committing/pushing a release with undeployed code.
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-check.ps1') -CloudOnly
  if ($LASTEXITCODE -ne 0) { throw 'Cloud verification failed. Deploy/fix the intended changes first.' }
  if (@(GitChecked @('status','--porcelain')).Count) {
    GitChecked @('add','-A') | Out-Host
    GitChecked @('commit','-m',$Message) | Out-Host
  }
  GitChecked @('tag','-a',$Tag,'-m',$Message) | Out-Host
  # Atomic push avoids publishing a branch without its release tag.
  GitChecked @('push','--atomic','origin','HEAD:refs/heads/master',"refs/tags/$Tag") | Out-Host
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-check.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Post-release verification failed; release is not complete.' }
  Write-Host "[PASS] Released $Tag. Record the separate business regression results."
  exit 0
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
