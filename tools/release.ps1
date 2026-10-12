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
  & node (Join-Path $PSScriptRoot '../tests/wp01/run.cjs') --assert-release
  if ($LASTEXITCODE -ne 0) { throw 'WP01 safety gate blocked release. Run npm run test:wp01 and resolve the reported blocker.' }
  GitChecked @('fetch','origin','master') | Out-Host
  GitChecked @('merge-base','--is-ancestor','origin/master','HEAD') | Out-Null
  # A failed cloud check prevents committing/pushing a release with undeployed code.
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-check.ps1') -CloudOnly
  if ($LASTEXITCODE -ne 0) { throw 'Cloud verification failed. Deploy/fix the intended changes first.' }
  if (@(GitChecked @('status','--porcelain')).Count) {
    # Stage edits and deletions to tracked files only. New artifacts must be staged
    # explicitly by the work package so user-owned untracked files stay untouched.
    GitChecked @('add','-u') | Out-Host
    GitChecked @('commit','-m',$Message) | Out-Host
  }
  GitChecked @('tag','-a',$Tag,'-m',$Message) | Out-Host
  # Atomic push avoids publishing a branch without its release tag.
  GitChecked @('push','--atomic','origin','HEAD:refs/heads/master',"refs/tags/$Tag") | Out-Host
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-check.ps1') `
    -PreservedUntracked @(
      'docs/CRM Person中心系统现状与Codex执行计划 20261011 晚间复核版.docx',
      'docs/CRM Person中心系统现状与Codex执行计划 20261011.docx',
      'docs/testing/person-plan-20261011-snapshot.json',
      'docs/work-packages/pc01-baseline-20261011.md'
    )
  if ($LASTEXITCODE -ne 0) { throw 'Post-release verification failed; release is not complete.' }
  Write-Host "[PASS] Released $Tag. Record the separate business regression results."
  exit 0
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
