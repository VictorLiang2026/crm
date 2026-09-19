# Resolve the existing CloudBase CLI without changing the user's PATH.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CliArgs)
$ErrorActionPreference = 'Stop'
$command = Get-Command tcb.cmd -ErrorAction SilentlyContinue
if ($command) { $cli = $command.Source }
else { $cli = Join-Path $env:APPDATA 'npm\tcb.cmd' }
if (!(Test-Path -LiteralPath $cli)) { throw 'CloudBase CLI not found. Install/login before deployment.' }
& $cli @CliArgs
if ($LASTEXITCODE -ne 0) { throw "CloudBase CLI failed (exit $LASTEXITCODE)." }
