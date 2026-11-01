$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'mutation-files.cs'),(Join-Path $PSScriptRoot 'postgres-runtime-guard.cs') -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Security'
[Observanda.MutationFiles]::RunPostgresGuard()
