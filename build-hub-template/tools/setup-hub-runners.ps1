#requires -version 5.1
# Windows Server 2016 x64; install exactly TWO independent runners for PRIVATE hub.
# Does not change services, registry, FTPS Gateway, firewall, or production FTP.
param(
  [string]$HubUrl='https://github.com/ngocnhanvo/esc-build-hub',
  [string]$Root=(Join-Path $env:USERPROFILE 'ESC-Build')
)
$ErrorActionPreference='Stop'
if($HubUrl -ne 'https://github.com/ngocnhanvo/esc-build-hub'){throw 'Unexpected private Hub URL'}
if(-not[Environment]::Is64BitOperatingSystem){throw 'Windows x64 is required'}
if($PSVersionTable.PSVersion.Major -lt 5){throw 'PowerShell 5.1 or newer required'}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'Run as a standard Windows user (not Administrator). Protect the FTPS Gateway.'
}
$runnerUrl='https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-win-x64-2.337.0.zip'
$expected='1150692afa94e71f872017e254ea55b6eece1eece3fe7e3a6d4c93d0a1b85cfc'
$archive=Join-Path $Root 'downloads/actions-runner-win-x64-2.337.0.zip'
New-Item -ItemType Directory -Force -Path (Split-Path $archive -Parent)|Out-Null
if(-not(Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){
  Write-Host 'Downloading verified GitHub Actions runner v2.337.0 once...'
  Invoke-WebRequest -Uri $runnerUrl -UseBasicParsing -OutFile $archive
}
if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){
  Remove-Item $archive -Force -ErrorAction SilentlyContinue
  throw 'Runner SHA-256 mismatch. Refusing installation.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$registrationToken=Read-Host 'Paste the NEW private ESC Build Hub registration token (never share it in chat)'
if([string]::IsNullOrWhiteSpace($registrationToken)){throw 'Missing private runner registration token'}
foreach($id in 1..2){
  $runnerName='ESC-HUB-WORKER-{0:00}' -f $id
  $folder=Join-Path $Root ('runners/worker-{0:00}' -f $id)
  $config=Join-Path $folder '.runner'
  if(Test-Path $config){
    Write-Host "$runnerName already registered; skipping. Do not register twice."
    continue
  }
  if(Test-Path $folder){
    if(@(Get-ChildItem $folder -Force).Count -gt 0){throw "$folder exists but is not registered. Inspect it before rerunning setup."}
  }
  New-Item -ItemType Directory -Force -Path $folder|Out-Null
  Write-Host "Installing $runnerName..."
  [IO.Compression.ZipFile]::ExtractToDirectory($archive,$folder)
  Push-Location $folder
  try{
    & .\config.cmd --unattended --url $HubUrl --token $registrationToken --name $runnerName --labels esc-build-worker --work _work --replace
    if($LASTEXITCODE -ne 0){throw "$runnerName registration failed"}
  }finally{Pop-Location}
}
$registrationToken=$null
Write-Host 'Runner registration completed. Open Settings > Actions > Runners in the private Build Hub to verify both.'
Write-Host 'Run tools/start-hub-runners.cmd as the same Windows user to start two independent jobs.'
