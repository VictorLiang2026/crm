# No deployment or business invocation. Errors must never become a green result.
param([switch]$CloudOnly, [switch]$AllowPreservedDocs)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
function GitRead([string[]]$Arguments) {
  $result = & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed." }
  return $result
}
function SourceFilesMatch([string]$Left, [string]$Right) {
  if ((Get-FileHash -LiteralPath $Left -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $Right -Algorithm SHA256).Hash) { return $true }
  $textExtensions = @('.js', '.cjs', '.mjs', '.ts', '.json', '.sql', '.md', '.txt', '.yml', '.yaml')
  if ([IO.Path]::GetExtension($Left).ToLowerInvariant() -notin $textExtensions) { return $false }
  $utf8 = [Text.UTF8Encoding]::new($false, $true)
  try {
    $leftText = $utf8.GetString([IO.File]::ReadAllBytes($Left)).Replace("`r`n", "`n")
    $rightText = $utf8.GetString([IO.File]::ReadAllBytes($Right)).Replace("`r`n", "`n")
    return $leftText -ceq $rightText
  } catch {
    return $false
  }
}
try {
  $config = Get-Content (Join-Path $repo 'cloudbaserc.json') -Raw | ConvertFrom-Json
  if ($config.envId -ne 'crm-d1gkae8ddc930d151') { throw 'Unexpected environment.' }
  & node (Join-Path $PSScriptRoot 'sync-shared.cjs') --check
  if ($LASTEXITCODE -ne 0) { throw 'Shared module hash check failed.' }
  if (!$CloudOnly) {
    $preservedUntracked = @()
    if ($AllowPreservedDocs) {
      $preservedUntracked = @(
        'docs/CRM Person中心系统现状与Codex执行计划 20261011 晚间复核版.docx',
        'docs/CRM Person中心系统现状与Codex执行计划 20261011.docx',
        'docs/testing/person-plan-20261011-snapshot.json',
        'docs/work-packages/pc01-baseline-20261011.md'
      )
    }
    $trackedChanges = @(GitRead @('status','--porcelain','--untracked-files=no'))
    $untracked = @(GitRead @('ls-files','--others','--exclude-standard'))
    $unexpectedUntracked = @($untracked | Where-Object { $_ -notin $preservedUntracked })
    if ($trackedChanges.Count -or $unexpectedUntracked.Count) {
      throw 'Uncommitted tracked changes or unapproved untracked files.'
    }
    $branch = GitRead @('branch','--show-current')
    if ($branch -ne 'master') { throw 'Release verification requires master.' }
    $local = GitRead @('rev-parse','HEAD')
    $remote = @(GitRead @('ls-remote','origin','refs/heads/master'))
    if ($remote.Count -ne 1 -or ($remote[0] -split '\s+')[0] -ne $local) { throw 'Local HEAD differs from live GitHub master.' }
    $tags = @(GitRead @('tag','--points-at','HEAD'))
    if (!$tags.Count) { throw 'HEAD has no release tag.' }
    $remoteTags = @(GitRead @('ls-remote','--tags','origin'))
    foreach ($tag in $tags) {
      $object = GitRead @('rev-parse',"refs/tags/$tag")
      if (!($remoteTags -contains "$object`trefs/tags/$tag")) { throw "Missing or different remote tag: $tag" }
    }
    Write-Host "[OK] GitHub master and release tags match HEAD $local"
  }
  $url = 'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html'
  $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $onlineHash = [BitConverter]::ToString($sha.ComputeHash($page.RawContentStream.ToArray())).Replace('-','') }
  finally { $sha.Dispose() }
  if ($onlineHash -ne (Get-FileHash (Join-Path $repo 'admin.html') -Algorithm SHA256).Hash) { throw 'Online admin.html differs from local.' }
  Write-Host '[OK] Online admin.html HTTP 200 and SHA-256 match'
  & node (Join-Path $PSScriptRoot '../tests/wp01/static.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Online frontend module/style verification failed.' }
  $dirs = @(Get-ChildItem (Join-Path $repo 'cloudfunctions') -Directory | Where-Object Name -ne '_shared')
  $names = @($config.functions | ForEach-Object { $_.name })
  if (@(Compare-Object @($dirs.Name | Sort-Object) @($names | Sort-Object)).Count) { throw 'Function manifest does not match local directories.' }
  $auditRoot = if ($env:CRM_SYNC_AUDIT_ROOT) { $env:CRM_SYNC_AUDIT_ROOT } else { $env:TEMP }
  $auditRoot = (Resolve-Path -LiteralPath $auditRoot).Path
  $audit = Join-Path $auditRoot ('crm-cloud-audit-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $audit | Out-Null
  $checked = 0
  foreach ($dir in $dirs) {
    $dest = Join-Path $audit $dir.Name
    $downloaded = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        & (Join-Path $PSScriptRoot 'tcb.ps1') -CliArgs @('fn','code','download',$dir.Name,$dest,'-e',$config.envId,'--json') | Out-Null
        $downloaded = $true
        break
      } catch {
        if ($attempt -eq 3) { throw "Cloud code download failed after 3 attempts for $($dir.Name): $($_.Exception.Message)" }
        Write-Host "[RETRY] $($dir.Name) cloud code download attempt $attempt failed; retrying."
        Start-Sleep -Seconds (2 * $attempt)
      }
    }
    if (!$downloaded) { throw "Cloud code download failed for $($dir.Name)." }
    $localFiles = @(Get-ChildItem $dir.FullName -Recurse -File | Where-Object FullName -notmatch '\\node_modules\\')
    $remoteFiles = @(Get-ChildItem $dest -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Name -ne 'package-lock.json' })
    foreach ($file in $localFiles) {
      $relative = $file.FullName.Substring($dir.FullName.Length + 1)
      $other = Join-Path $dest $relative
      if (!(Test-Path -LiteralPath $other)) { throw "Missing online: $($dir.Name)/$relative" }
      if (!(SourceFilesMatch -Left $file.FullName -Right $other)) { throw "Source differs: $($dir.Name)/$relative" }
      $checked++
    }
    foreach ($file in $remoteFiles) {
      $relative = $file.FullName.Substring($dest.Length + 1)
      if (!(Test-Path -LiteralPath (Join-Path $dir.FullName $relative))) { throw "Extra online source: $($dir.Name)/$relative" }
    }
    Write-Host "[OK] $($dir.Name)"
  }
  Write-Host "[OK] $($dirs.Count) functions, $checked source/config files match. Evidence: $audit"
  if ($CloudOnly) { Write-Host '[PASS] Cloud source check only; GitHub and business regression not checked.' }
  else { Write-Host '[PASS] Local / GitHub / cloud sources match. Business regression is separate.' }
  exit 0
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
