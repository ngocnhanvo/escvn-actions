#requires -version 5.1
# Private ESC Build Hub runner; never uploads FTP.
param(
  [Parameter(Mandatory=$true)][ValidateSet('esc','anhsang')][string]$Project,
  [Parameter(Mandatory=$true)][string]$CheckoutRoot,
  [string]$BasePath=(Join-Path $env:USERPROFILE 'ESC-Build'),
  [ValidateSet('fresh','warm')][string]$CacheMode='fresh',
  [string]$ExpectedCommit=''
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($env:HUB_ENV_FILE)){throw "Missing private ENV_FILE for $Project"}
if(-not(Test-Path (Join-Path $CheckoutRoot 'pnpm-lock.yaml'))){throw 'No Astro source checkout'}
$actual=(& git -C $CheckoutRoot rev-parse HEAD | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $actual -notmatch '^[a-f0-9]{40}$'){throw 'Cannot resolve Astro source commit'}
if($ExpectedCommit -and $actual -ne $ExpectedCommit){throw 'Source commit mismatch'}
$pnpmVersion=(& pnpm --version | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $pnpmVersion -notmatch '^9\.'){throw 'pnpm 9 required'}
$nodeVersion=(& node --version | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.'){throw 'Node.js 24 required'}

$prepareScript=Join-Path $env:GITHUB_WORKSPACE 'control/build-hub-template/scripts/persistent-deps.mjs'
if(-not(Test-Path $prepareScript)){throw 'Missing persistent deps program'}
$prepared=(& node $prepareScript prepare $Project $CheckoutRoot $BasePath $pnpmVersion | Out-String).Trim()
if($LASTEXITCODE -ne 0){throw 'Persistent deps preparation failed'}
$details=$prepared | ConvertFrom-Json
$workspace=[string]$details.workspace
$store=[string]$details.store
if(-not(Test-Path (Join-Path $workspace 'pnpm-lock.yaml'))){throw 'Prepared source is invalid'}

$timer=[Diagnostics.Stopwatch]::StartNew()
$depsSeconds=0;$buildSeconds=0
$dotenv=Join-Path $workspace '.env'
[IO.File]::WriteAllText($dotenv,$env:HUB_ENV_FILE,([Text.UTF8Encoding]::new($false)))
try{
  Push-Location $workspace
  try{
    if($details.needsInstall){
      & pnpm install --frozen-lockfile --prefer-offline --store-dir $store
      if($LASTEXITCODE -ne 0){throw 'pnpm install failed'}
      & node $prepareScript mark-installed $Project $CheckoutRoot $BasePath $pnpmVersion
      if($LASTEXITCODE -ne 0){throw 'Cannot mark dependency state'}
    }else{
      Write-Host 'Valid persistent node_modules: skipping pnpm install'
    }
    $timer.Stop()
    $depsSeconds=[math]::Round($timer.Elapsed.TotalSeconds,2)
    $timer.Restart()

    # Fresh WordPress data. The preprocessed image cache remains for speed.
    if($CacheMode -eq 'fresh'){
      $wpCache=Join-Path $workspace '.cache'
      if(Test-Path $wpCache){
        Get-ChildItem -LiteralPath $wpCache -Force | ForEach-Object {
          if($_.Name -ne 'images'){Remove-Item -LiteralPath $_.FullName -Recurse -Force}
        }
      }
    }
    foreach($p in @('dist','deploy','upload')){
      $target=Join-Path $workspace $p
      if(Test-Path $target){Remove-Item -LiteralPath $target -Force -Recurse}
    }
    foreach($key in @('cacheAll','cachePage','cacheProduct','cacheTablePress','cacheRedirect','cacheMenu','cacheProductCategory')){
      [Environment]::SetEnvironmentVariable($key,'false','Process')
    }
    if($Project -eq 'anhsang'){
      $env:WC_URL_CLIENT='https://anhsangvacuocsong.vn'
      $sitemap='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://anhsangvacuocsong.vn/</loc></url></urlset>'
      $robots=@('User-agent: *','Allow: /','Sitemap: https://anhsangvacuocsong.vn/sitemap.xml') -join [Environment]::NewLine
      [IO.File]::WriteAllText((Join-Path $workspace 'public/sitemap.xml'),$sitemap)
      [IO.File]::WriteAllText((Join-Path $workspace 'public/robots.txt'),$robots)
    }
    & pnpm run build-git
    if($LASTEXITCODE -ne 0){throw 'Astro build failed'}
    if(-not(Test-Path (Join-Path $workspace 'dist/server/entry.mjs'))){throw 'Missing Astro server entry'}
    if(-not(Test-Path (Join-Path $workspace 'dist/client'))){throw 'Missing Astro client output'}
    if($Project -eq 'anhsang'){
      & pnpm sitemap
      if($LASTEXITCODE -ne 0){throw 'SEO sitemap generation failed'}
      foreach($name in @('sitemap.xml','robots.txt')){
        Copy-Item -LiteralPath (Join-Path $workspace "public/$name") -Destination (Join-Path $workspace "dist/client/$name") -Force
      }
      & node --input-type=module -e 'import {syncSeoFiles} from "./scripts/sync-seo-files.mjs"; await syncSeoFiles({distDir:"dist/client"});'
      if($LASTEXITCODE -ne 0){throw 'WordPress SEO sync failed'}
      foreach($name in @('sitemap.xml','robots.txt','llms.txt')){
        if(-not(Test-Path (Join-Path $workspace "dist/client/$name"))){throw "Missing SEO file $name"}
      }
    }
    & node --check (Join-Path $workspace 'dist/server/entry.mjs')
    if($LASTEXITCODE -ne 0){throw 'Invalid Astro standalone server entry'}
    $timer.Stop()
    $buildSeconds=[math]::Round($timer.Elapsed.TotalSeconds,2)
  }finally{Pop-Location}
  $report=[ordered]@{
    project=$Project;source_sha=$actual;deps_reused=(-not $details.needsInstall)
    dependency_seconds=$depsSeconds;build_seconds=$buildSeconds;cache_mode=$CacheMode
    build_dist_ok=$true;ftp_deployed=$false;utc=[DateTime]::UtcNow.ToString('o')
  }
  [IO.File]::WriteAllText((Join-Path $env:GITHUB_WORKSPACE 'build-report.json'),($report|ConvertTo-Json -Depth 5),[Text.Encoding]::UTF8)
  if($env:GITHUB_STEP_SUMMARY){
    Add-Content $env:GITHUB_STEP_SUMMARY "|Project|Source|Dependency seconds|Build seconds|"
    Add-Content $env:GITHUB_STEP_SUMMARY "|---|---|---:|---:|"
    Add-Content $env:GITHUB_STEP_SUMMARY "|$Project|$actual|$depsSeconds|$buildSeconds|"
    Add-Content $env:GITHUB_STEP_SUMMARY 'Build only; no FTP, zip deployment, or production mutation.'
  }
  Write-Host "PASS: $Project. Dependency seconds=$depsSeconds; Astro seconds=$buildSeconds. NO FTP."
}finally{
  Remove-Item -LiteralPath $dotenv -Force -ErrorAction SilentlyContinue
  Remove-Item Env:HUB_ENV_FILE -ErrorAction SilentlyContinue
}
