param([Parameter(Mandatory=$true)][string]$Roots)
$ErrorActionPreference = 'Stop'
if ($Roots -notmatch '^[1-9][0-9]*(,[1-9][0-9]*)*$') { throw 'Invalid process roots' }
$selected = [System.Collections.Generic.HashSet[uint32]]::new()
foreach ($value in $Roots.Split(',')) { [void]$selected.Add([uint32]$value) }
$rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,UserModeTime,KernelModeTime)
do {
    $changed = $false
    foreach ($row in $rows) {
        if ($row.ProcessId -ne $PID -and $selected.Contains([uint32]$row.ParentProcessId) -and $selected.Add([uint32]$row.ProcessId)) { $changed = $true }
    }
} while ($changed)
$included = @($rows | Where-Object { $_.ProcessId -ne $PID -and $selected.Contains([uint32]$_.ProcessId) })
$rss = 0L; $userTime = 0L; $kernelTime = 0L
foreach ($row in $included) { $rss += [long]$row.WorkingSetSize; $userTime += [long]$row.UserModeTime; $kernelTime += [long]$row.KernelModeTime }
$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -Property PercentProcessorTime
@{ processes=$included.Count; rssBytes=$rss; cpuUserUs=[math]::Round($userTime/10); cpuSystemUs=[math]::Round($kernelTime/10); machineCpuPercent=[double]$cpu.PercentProcessorTime } | ConvertTo-Json -Compress
