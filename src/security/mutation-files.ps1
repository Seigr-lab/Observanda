$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'mutation-files.cs') -ReferencedAssemblies 'System.Web.Extensions','System.Core'
[Observanda.MutationFiles]::Run()
