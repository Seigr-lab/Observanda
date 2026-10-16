param([Parameter(Mandatory=$true)][string]$LockFile)
$ErrorActionPreference = 'Stop'
$stream = $null
try {
  if (Test-Path -LiteralPath $LockFile) {
    $item = Get-Item -LiteralPath $LockFile
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 74 }
  }
  try { $stream = [IO.File]::Open($LockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
  catch [IO.IOException] { exit 73 }
  [Console]::Out.WriteLine('locked')
  [Console]::Out.Flush()
  while ([Console]::In.Read() -ne -1) { }
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
