param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $Directory
if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe directory' }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
# Runtime tool installation can reuse an already exact private DACL.
# Database clusters use the native runtime guard instead of this helper.
$existing = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$rules = @($existing.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$private = $existing.AreAccessRulesProtected -and $rules.Count -gt 0
$hasUser = $false
$hasSystem = $false
foreach ($rule in $rules) {
  $sid = $rule.IdentityReference.Value
  if ($sid -eq $user.Value) { $hasUser = $true }
  if ($sid -eq $system.Value) { $hasSystem = $true }
  if (($sid -ne $user.Value -and $sid -ne $system.Value) -or
      $rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or
      [int]$rule.FileSystemRights -ne 2032127 -or
      [int]$rule.InheritanceFlags -ne 3 -or [int]$rule.PropagationFlags -ne 0) { $private = $false }
}
if ($private -and $hasSystem -and $hasUser) { return }
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($user, $system)) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
# Apply only the access rules. Set-Acl also requests audit privileges on Windows.
[IO.Directory]::SetAccessControl($Directory, $acl)
