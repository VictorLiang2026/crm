# Resolve the existing CloudBase CLI without changing the user's PATH.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CliArgs)
$ErrorActionPreference = 'Stop'
# Guard: CloudBase CLI 3.8.1 treats a bare invocation (no explicit subcommand, e.g. "tcb -v")
# as "deploy every function in cloudbaserc.json" and only stops at an interactive overwrite prompt.
# Require an explicit subcommand word so a typo can never start an interactive full deploy.
if ($null -eq $CliArgs -or $CliArgs.Count -eq 0) {
  throw 'No tcb subcommand given. Always pass an explicit command (e.g. fn list, fn code download/update, hosting ...). Bare invocation defaults to a full deploy and is blocked.'
}
$first = [string]$CliArgs[0]
if ($first.StartsWith('-')) {
  throw "Ambiguous tcb arguments ('$first') are blocked: a bare flag invocation defaults to deploying all functions. Pass an explicit subcommand first (e.g. fn list -e <envId> --json). For the CLI version, check the installed npm package."
}
$command = Get-Command tcb.cmd -ErrorAction SilentlyContinue
if ($command) { $cli = $command.Source }
else { $cli = Join-Path $env:APPDATA 'npm\tcb.cmd' }
if (!(Test-Path -LiteralPath $cli)) { throw 'CloudBase CLI not found. Install/login before deployment.' }
& $cli @CliArgs
if ($LASTEXITCODE -ne 0) { throw "CloudBase CLI failed (exit $LASTEXITCODE)." }
