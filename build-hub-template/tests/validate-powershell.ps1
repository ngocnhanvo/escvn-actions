#requires -version 5.1
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$files=@(
  (Join-Path $root 'scripts/run-project-build.ps1'),
  (Join-Path $root 'tools/setup-hub-runners.ps1'),
  (Join-Path $root 'scripts/vps-resource-probe.ps1')
)
foreach($f in $files){
  if(-not(Test-Path $f)){throw "Missing build hub script: $f"}
  $tokens=$null
  $errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$tokens,[ref]$errors)|Out-Null
  if($null -ne $errors -and $errors.Count -gt 0){
    foreach($issue in $errors){Write-Host "PowerShell syntax error: $($issue.Message)"}
    throw "Script syntax invalid: $f"
  }
  Write-Host "PowerShell parsed successfully: $f"
}
