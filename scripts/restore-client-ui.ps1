[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SnapshotPath,
    [string]$TargetDirectory = 'dist/client',
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$snapshot = (Resolve-Path -LiteralPath $SnapshotPath).Path.TrimEnd('\')
$restoreRoot = Join-Path $workspace '.local\ui-rollback'
$target = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $TargetDirectory)).TrimEnd('\')
$liveTarget = Join-Path $workspace 'dist\client'
if (-not $snapshot.StartsWith($restoreRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Snapshot must be inside this workspace UI rollback directory.' }
if ($target -ne $liveTarget -and -not $target.StartsWith($restoreRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Restore target must be the client build or an isolated rollback drill directory.' }
foreach ($candidate in @($snapshot, $target)) {
    for ($part = $candidate; $part -and $part -ne $workspace; $part = Split-Path -Parent $part) {
        if ((Test-Path -LiteralPath $part) -and ((Get-Item -LiteralPath $part).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Restore paths cannot contain links or junctions.' }
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 'nancy-client-ui-restore-v1') { throw 'Unrecognized restore manifest.' }
$entries = @($manifest.entries | Where-Object { $_.kind -eq 'build' })
if (@($entries | Where-Object { $_.path -eq 'index.html' }).Count -ne 1) { throw 'Restore requires one verified index.' }
foreach ($entry in $entries) {
    if ($entry.path -match '(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)' -or $entry.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid restore entry.' }
    $source = [IO.Path]::GetFullPath((Join-Path (Join-Path $snapshot 'build') $entry.path))
    if (-not $source.StartsWith((Join-Path $snapshot 'build') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Restore entry outside snapshot.' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Snapshot file does not match its recorded hash.' }
}
if (-not $VerifyOnly) {
    if ($target -eq $liveTarget -and (Test-Path -LiteralPath (Join-Path $target 'index.html'))) {
        $backup = Join-Path $restoreRoot ('index-before-restore-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.html')
        Copy-Item -LiteralPath (Join-Path $target 'index.html') -Destination $backup
    }
    # Publish assets first, then the entry page. No care data, configuration or server process is changed.
    foreach ($entry in @($entries | Where-Object { $_.path -ne 'index.html' }) + @($entries | Where-Object { $_.path -eq 'index.html' })) {
        $destination = [IO.Path]::GetFullPath((Join-Path $target $entry.path))
        if (-not $destination.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination outside restore target.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path (Join-Path $snapshot 'build') $entry.path) -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Restored file failed verification.' }
    }
}
[ordered]@{ verified = $true; files = $entries.Count; restored = (-not $VerifyOnly); live_target = ($target -eq $liveTarget); client_bundle = $manifest.client_bundle; data_or_configuration_changed = $false } | ConvertTo-Json -Compress
