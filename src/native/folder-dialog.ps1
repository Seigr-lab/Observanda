param([switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $interactive = [Environment]::UserInteractive -and ([Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0)
    if ($Probe) { @{ interactive = $interactive } | ConvertTo-Json -Compress; exit 0 }
    if (-not $interactive) { exit 3 }
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -Path (Join-Path $PSScriptRoot 'folder-dialog.cs')
    $selected = [Observanda.Native.FolderDialog]::Choose($request.initialPath)
    @{ folder = $selected; cancelled = ($null -eq $selected) } | ConvertTo-Json -Compress
} catch { exit 2 }
