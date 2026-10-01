# Hosts AcHelper.cs. The compiled assembly is cached next to this script, keyed by
# the source hash in the file name, so only the first launch pays the compile cost.
param([int]$OwnerPid, [string]$AssemblyPath)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::ASCII
[Console]::OutputEncoding = [System.Text.Encoding]::ASCII

if (-not (Test-Path $AssemblyPath)) {
  $source = Join-Path $PSScriptRoot 'AcHelper.cs'
  Add-Type -Path $source -OutputAssembly $AssemblyPath -OutputType Library
}
Add-Type -Path $AssemblyPath
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
[AcHelper]::Run($OwnerPid)
