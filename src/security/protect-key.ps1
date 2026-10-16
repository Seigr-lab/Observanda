$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $bytes = [Convert]::FromBase64String($request.bytes)
    $entropy = [Text.Encoding]::UTF8.GetBytes('Observanda/device-private-key/v1')
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.operation -eq 'protect') {
        $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
    } elseif ($request.operation -eq 'unprotect') {
        $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
    } else { exit 1 }
    [Console]::Out.Write([Convert]::ToBase64String($result))
    [Array]::Clear($bytes, 0, $bytes.Length)
    [Array]::Clear($result, 0, $result.Length)
} catch { exit 1 }
