[CmdletBinding()]
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$taskName = 'Nancy Local Demo'
if ($Uninstall) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'Nancy startup task removed. The database and ingress settings were preserved.'
    return
}
$configPath = Join-Path $repoRoot '.local/runtime/demo-host.json'
if (!(Test-Path -LiteralPath $configPath)) { throw 'Create the private demo-host.json with the approved origin first.' }
$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$nancyUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$runner = Join-Path $PSScriptRoot 'start-local-demo.ps1'
$action = New-ScheduledTaskAction -Execute $pwshPath -Argument "-NoProfile -WindowStyle Hidden -File `"$runner`"" -WorkingDirectory $repoRoot
$principal = New-ScheduledTaskPrincipal -UserId $nancyUser -LogonType Interactive -RunLevel Limited
$logon = New-ScheduledTaskTrigger -AtLogOn -User $nancyUser
# A periodic trigger also recovers a stopped supervisor without a new sign-in.
$retry = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $retry) -Principal $principal -Settings $settings -Description 'Runs Nancy and recovers its local database/app. Starts after this Windows user signs in. Does not publish ingress or change credentials.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Nancy startup task installed for this Windows user; a Windows sign-in is required after reboot.'
