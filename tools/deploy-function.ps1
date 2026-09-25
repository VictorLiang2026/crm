# CRM code-only deployment. Shared sources are synchronized and verified before upload.
param([Parameter(Mandatory=$true)][string]$Function)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
try {
  $config = Get-Content (Join-Path $repo 'cloudbaserc.json') -Raw | ConvertFrom-Json
  if ($config.envId -ne 'crm-d1gkae8ddc930d151') { throw 'Unexpected CloudBase environment.' }
  $names = @($config.functions | ForEach-Object { $_.name })
  if ($Function -notmatch '^[a-z][a-z0-9_]*$' -or $Function.StartsWith('pr_') -or $Function -notin $names) {
    throw "Function is not an approved CRM target: $Function"
  }
  & node (Join-Path $PSScriptRoot 'sync-shared.cjs') --sync
  if ($LASTEXITCODE -ne 0) { throw 'Shared module sync failed; deployment blocked.' }
  & node (Join-Path $PSScriptRoot 'sync-shared.cjs') --check
  if ($LASTEXITCODE -ne 0) { throw 'Shared module hash check failed; deployment blocked.' }
  $directory = Join-Path (Join-Path $repo 'cloudfunctions') $Function
  & (Join-Path $PSScriptRoot 'tcb.ps1') -CliArgs @('fn','code','update',$Function,'--dir',$directory,'-e',$config.envId,'--json')
  if ($LASTEXITCODE -ne 0) { throw 'CloudBase code update failed.' }
  Write-Host "[PASS] $Function code uploaded after shared hash verification. Run cloud sync check and business regression."
  exit 0
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
