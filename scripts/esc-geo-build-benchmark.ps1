#requires -version 5.1
param([string]$ProjectDir='source',[string]$OutputFile='esc-geo-build.json')
$ErrorActionPreference='Stop'
if(-not $env:BENCH_ENV){throw 'The existing GitHub ENV_FILE secret is missing'}
$src=Join-Path $env:GITHUB_WORKSPACE $ProjectDir
$dotenv=Join-Path $src '.env'
if(-not(Test-Path (Join-Path $src 'pnpm-lock.yaml'))){throw 'Missing Astro source or lockfile'}
[IO.File]::WriteAllText($dotenv,$env:BENCH_ENV,(New-Object System.Text.UTF8Encoding $false))
try{
  Push-Location $src
  try{
    $t=[Diagnostics.Stopwatch]::StartNew()
    & pnpm install --frozen-lockfile
    if($LASTEXITCODE -ne 0){throw 'pnpm install failed'}
    $t.Stop();$install=[math]::Round($t.Elapsed.TotalSeconds,2)
    $t.Restart()
    & pnpm run build-git
    if($LASTEXITCODE -ne 0){throw 'Astro build failed'}
    $t.Stop();$build=[math]::Round($t.Elapsed.TotalSeconds,2)
  }finally{Pop-Location}
  [pscustomobject]@{runner=$env:RUNNER_NAME;os=[Environment]::OSVersion.VersionString;install_seconds=$install;astro_seconds=$build;production_deployed=$false;utc=[DateTime]::UtcNow.ToString('o')} |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $OutputFile
  Write-Host "Build passed. pnpm install=$install s, Astro build=$build s. NO DEPLOY."
  if($env:GITHUB_STEP_SUMMARY){
    Add-Content $env:GITHUB_STEP_SUMMARY "### $($env:RUNNER_NAME): build test ONLY"
    Add-Content $env:GITHUB_STEP_SUMMARY "|Step|Duration (seconds)|"
    Add-Content $env:GITHUB_STEP_SUMMARY "|---|---:|"
    Add-Content $env:GITHUB_STEP_SUMMARY "|pnpm install|$install|"
    Add-Content $env:GITHUB_STEP_SUMMARY "|Astro build|$build|"
  }
}finally{
  Remove-Item $dotenv -Force -ErrorAction SilentlyContinue
}
