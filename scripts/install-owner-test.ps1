[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$testRoot=Join-Path $repoRoot '.local/owner-test'
$settings=Get-Content -LiteralPath (Join-Path $testRoot 'config.json') -Raw|ConvertFrom-Json
if($settings.database_name -ne 'nancy_owner_test' -or $settings.database_role -ne 'nancy_owner_test' -or $settings.port -ne 8788 -or ([uri]$settings.origin).Port -ne 10000){throw 'Unexpected test environment configuration.'}
$runner=Join-Path $testRoot 'start.ps1'
$escapedRoot=$repoRoot.Replace("'","''")
@"
`$ErrorActionPreference='Stop'
Set-Location -LiteralPath '$escapedRoot'
& node 'scripts/run-local-demo.mjs' --owner-test
exit `$LASTEXITCODE
"@|Set-Content -LiteralPath $runner
$pwshPath=(Get-Command pwsh -ErrorAction Stop).Source
$windowless=Join-Path $PSScriptRoot 'start-local-demo.vbs'
$action=New-ScheduledTaskAction -Execute (Join-Path ([Environment]::GetFolderPath('System')) 'wscript.exe') -Argument "//B //Nologo `"$windowless`" `"$pwshPath`" `"$runner`"" -WorkingDirectory $repoRoot
$account=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$logon=New-ScheduledTaskTrigger -AtLogOn -User $account
$retry=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Nancy Owner Test' -Action $action -Trigger @($logon,$retry) -Principal $principal -Settings $settings -Description 'Runs the separate owner-only synthetic Nancy test environment. Does not change the live app or publish ingress.' -Force|Out-Null
Start-ScheduledTask -TaskName 'Nancy Owner Test'
Write-Output 'Separate Nancy Owner Test startup task installed and started.'
