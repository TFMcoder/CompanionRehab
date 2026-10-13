$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
& node (Join-Path $PSScriptRoot 'run-local-demo.mjs')
exit $LASTEXITCODE
