# Failure-path tests: all Git calls are mocked; no network, commits or deployment.
$ErrorActionPreference = 'Stop'
$toolRoot = $PSScriptRoot.Replace("'", "''")
function AssertRejected([string]$Name, [string]$Code, [string]$Expected) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Code))
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 1 -or ($output -join "`n") -notmatch [regex]::Escape($Expected)) {
    throw "$Name failed: exit=$code output=$output"
  }
  Write-Host "[PASS] $Name"
}
AssertRejected 'Invalid tag rejected before Git' @"
function global:git { throw 'Git must not run' }
& '$toolRoot/release.ps1' -Message test -Tag invalid
"@ 'Invalid release tag'
AssertRejected 'Release stops on Git failure' @"
function global:git { `$global:LASTEXITCODE = 128; 'simulated failure' }
& '$toolRoot/release.ps1' -Message test -Tag release-20990101-000000
"@ 'failed.'
AssertRejected 'Remote query failure cannot report matching revisions' @"
function global:git {
  `$global:LASTEXITCODE = 0
  switch (`$args[0]) {
    status { return }
    branch { return 'master' }
    'rev-parse' { return 'abc' }
    'ls-remote' { `$global:LASTEXITCODE = 128; return }
    default { throw 'Unexpected command' }
  }
}
& '$toolRoot/sync-check.ps1'
"@ 'ls-remote origin refs/heads/master failed.'
