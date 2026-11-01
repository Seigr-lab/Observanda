param([int]$RootProcessId,[string]$StopFile,[string]$ResultsFile,[int]$IntervalMs=1000)
$ErrorActionPreference='Stop'
if ($RootProcessId -le 0 -or $IntervalMs -lt 250 -or $IntervalMs -gt 10000) { throw 'Invalid process sampling request' }
$timer=[Diagnostics.Stopwatch]::StartNew()
$known=@{}
$rootBirth=$null
$output=[IO.StreamWriter]::new($ResultsFile,$false,[Text.UTF8Encoding]::new($false))
try {
 while (-not [IO.File]::Exists($StopFile)) {
  try {
   # Inspect numeric resource/lifetime fields only. Never collect command lines,
   # executable paths, account names, environment variables or window titles.
   $rows=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,CreationDate,KernelModeTime,UserModeTime -OperationTimeoutSec 2)
   $selected=@{}
   foreach ($row in $rows) {
    $key=[string]$row.ProcessId
    $birth=$row.CreationDate.ToUniversalTime().Ticks
    if ($row.ProcessId -eq $RootProcessId -and $null -eq $rootBirth) { $rootBirth=$birth }
    if (($row.ProcessId -eq $RootProcessId -and $rootBirth -eq $birth) -or ($known.ContainsKey($key) -and $known[$key] -eq $birth)) { $selected[$key]=$row }
   }
   do {
    $changed=$false
    foreach ($row in $rows) {
     $key=[string]$row.ProcessId
     $parentKey=[string]$row.ParentProcessId
     if (-not $selected.ContainsKey($key) -and $selected.ContainsKey($parentKey) -and $row.CreationDate -ge $selected[$parentKey].CreationDate) { $selected[$key]=$row; $changed=$true }
    }
   } while ($changed)
   $known=@{}; [long]$bytes=0; [long]$cpu100ns=0
   foreach ($row in $selected.Values) { $known[[string]$row.ProcessId]=$row.CreationDate.ToUniversalTime().Ticks; $bytes+=[long]$row.WorkingSetSize; $cpu100ns+=[long]$row.KernelModeTime+[long]$row.UserModeTime }
   $output.WriteLine((@{elapsedMs=$timer.ElapsedMilliseconds;processes=$selected.Count;workingSetBytes=$bytes;liveCpuMilliseconds=$cpu100ns/10000;rootSeen=$selected.ContainsKey([string]$RootProcessId)} | ConvertTo-Json -Compress))
  } catch { $output.WriteLine((@{elapsedMs=$timer.ElapsedMilliseconds;error='sample-unavailable'} | ConvertTo-Json -Compress)) }
  $output.Flush()
  Start-Sleep -Milliseconds $IntervalMs
 }
} finally { $output.Dispose() }
