#requires -version 5.1
param([string]$OutputFile='esc-geo-api.json',[int]$Samples=6)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
$http=New-Object System.Net.Http.HttpClient
$http.Timeout=[TimeSpan]::FromSeconds(25)
$http.DefaultRequestHeaders.UserAgent.ParseAdd('ESC-Geo-Benchmark/1.0')
$targets=[ordered]@{
  'wp-root'='https://admin.esc.vn/wp-json/'
  'wp-pages'='https://admin.esc.vn/wp-json/wp/v2/pages?per_page=1&_fields=id,slug'
  'esc-table-status'='https://admin.esc.vn/wp-json/esc-table/v1/status'
}
function Measure([string]$url){
  $sw=[Diagnostics.Stopwatch]::StartNew()
  try{
    $response=$http.GetAsync($url).GetAwaiter().GetResult()
    $bytes=$response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $sw.Stop()
    $r=[pscustomobject]@{ms=[math]::Round($sw.Elapsed.TotalMilliseconds,1);status=[int]$response.StatusCode;bytes=$bytes.Length}
    $response.Dispose()
    return $r
  }catch{
    $sw.Stop()
    return [pscustomobject]@{ms=[math]::Round($sw.Elapsed.TotalMilliseconds,1);status=0;bytes=0}
  }
}
$report=@()
foreach($label in $targets.Keys){
  $warm=Measure -url ([string]$targets[$label])
  $readings=@()
  for($n=0;$n -lt $Samples;$n++){ $readings += (Measure -url ([string]$targets[$label])) }
  if($readings.Count -ne $Samples){throw "Probe produced $($readings.Count)/$Samples results for $label"}
  $good=@($readings|Where-Object{$_.status -ge 200 -and $_.status -lt 400}|Sort-Object ms)
  $median=$null
  if($good.Count -gt 0){$median=$good[[int][math]::Floor(($good.Count-1)/2)].ms}
  $statuses=@($readings|ForEach-Object{$_.status})
  if($statuses.Count -ne $Samples){throw "Missing statuses for $label"}
  $report += [pscustomobject]@{endpoint=$label;median_ms=$median;success=$good.Count;total=$Samples;warmup_ms=$warm.ms;statuses=$statuses;samples_ms=@($readings|ForEach-Object{$_.ms})}
  Write-Host "$label median=$median ms; success=$($good.Count)/$Samples; status=$($statuses -join ',')"
}
$http.Dispose()
[pscustomobject]@{runner=$env:RUNNER_NAME;os=[Environment]::OSVersion.VersionString;utc=[DateTime]::UtcNow.ToString('o');results=$report}|ConvertTo-Json -Depth 7|Set-Content -Encoding UTF8 $OutputFile
if($env:GITHUB_STEP_SUMMARY){
  Add-Content $env:GITHUB_STEP_SUMMARY '### ESC WordPress API median latency'
  Add-Content $env:GITHUB_STEP_SUMMARY '|API|Median (ms)|Successful requests|'
  Add-Content $env:GITHUB_STEP_SUMMARY '|---|---:|---:|'
  foreach($r in $report){Add-Content $env:GITHUB_STEP_SUMMARY "|$($r.endpoint)|$($r.median_ms)|$($r.success)/$Samples|"}
}
