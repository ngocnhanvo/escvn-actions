#requires -version 5.1
# ESC isolated benchmark runner for Windows Server 2016 x64.
# This script does not configure a Windows Service or touch the ESC FTPS Gateway.
param([string]$Version='2.336.0')
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'KHONG chay bang Administrator. Dang nhap Windows bang tai khoan thuong rieng cho runner benchmark.'
}
if(-not [Environment]::Is64BitOperatingSystem){throw 'Windows x64 required'}
$dir=Join-Path $env:USERPROFILE 'esc-geo-runner'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if(Test-Path (Join-Path $dir '.runner')){Write-Host 'Runner da dang ky. Chay 02-CHAY-RUNNER.cmd.';exit 0}
if(-not(Test-Path (Join-Path $dir 'config.cmd'))){
  $url="https://github.com/actions/runner/releases/download/v$Version/actions-runner-win-x64-$Version.zip"
  $zip=Join-Path $env:TEMP "esc-geo-runner-$Version.zip"
  Write-Host 'Dang tai runner Windows x64 tu GitHub...'
  Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  Remove-Item $zip -Force
}
Write-Host 'Lay token: https://github.com/ngocnhanvo/escvn-actions/settings/actions/runners/new'
$secure=Read-Host 'Paste ma dang ky runner (se an khi nhap)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{
  $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if([string]::IsNullOrWhiteSpace($token)){throw 'Registration token missing'}
  Push-Location $dir
  try{
    & .\config.cmd --unattended --url 'https://github.com/ngocnhanvo/escvn-actions' --token $token --name ("ESC-GEO-"+$env:COMPUTERNAME) --labels esc-geo-bench-win2016 --work _work
    if($LASTEXITCODE -ne 0){throw 'GitHub runner registration failed'}
  }finally{Pop-Location}
}finally{
  if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  $token=$null
  $secure.Dispose()
}
Write-Host 'DA DANG KY. Chay 02-CHAY-RUNNER.cmd trong bo ZIP.' -ForegroundColor Green
