#requires -version 5.1
param(
  [string]$ReportFile='machine-resources.json',
  [double]$MinFreeRamGB=4
)
$ErrorActionPreference='Stop'
$os=Get-CimInstance Win32_OperatingSystem
$computer=Get-CimInstance Win32_ComputerSystem
$cpu=@(Get-CimInstance Win32_Processor)
$cores=($cpu|Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
$totalGB=[math]::Round(([double]$computer.TotalPhysicalMemory/1GB),2)
$freeGB=[math]::Round(([double]$os.FreePhysicalMemory*1KB/1GB),2)
$diskRoot=[IO.Path]::GetPathRoot((Get-Location).Path)
$disk=Get-PSDrive -Name $diskRoot.Substring(0,1) -ErrorAction SilentlyContinue
$diskFreeGB=if($disk){[math]::Round(([double]$disk.Free/1GB),2)}else{$null}
$gateway=@(Get-Process -Name 'Gateway','ESCFTPSGateway' -ErrorAction SilentlyContinue)
$gatewayMB=[math]::Round((($gateway|Measure-Object -Property WorkingSet64 -Sum).Sum/1MB),2)
$report=[ordered]@{
  os=$os.Caption;logical_cpus=[int]$cores;total_ram_gb=$totalGB
  free_ram_gb=$freeGB;disk_free_gb=$diskFreeGB;gateway_ram_mb=$gatewayMB
  minimum_free_ram_gb=$MinFreeRamGB;utc=[DateTime]::UtcNow.ToString('o')
}
$report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $ReportFile -Encoding UTF8
Write-Host ("VPS CPU={0}, RAM total={1}GB, RAM free={2}GB, Gateway memory={3}MB" -f $cores,$totalGB,$freeGB,$gatewayMB)
if($freeGB -lt $MinFreeRamGB){
  throw ("Insufficient free RAM for an Astro worker: {0}GB available, need >= {1}GB. Build refused to protect the FTPS Gateway." -f $freeGB,$MinFreeRamGB)
}
